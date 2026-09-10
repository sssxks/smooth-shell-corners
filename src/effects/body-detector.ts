import Cogl from 'gi://Cogl';
import GLib from 'gi://GLib';
import Graphene from 'gi://Graphene';
import {BODY_PROBE_DECLARATIONS, BODY_PROBE_CODE,
    BODY_VALIDATE_DECLARATIONS, BODY_VALIDATE_CODE} from './shaders.js';

// Own the two tiny GPU targets and the debounce together, so destroying a
// window cannot leave a callback or a source texture behind. No pixel readback.
export class BodyDetector {
    pending = true;
    revision = 0;
    private timer = 0;
    private retries = 2;
    private geometry = '';
    private probe: Cogl.Offscreen;
    private result: Cogl.Offscreen;
    private probePipeline: Cogl.Pipeline;
    private validatePipeline: Cogl.Pipeline;

    constructor(context: Cogl.Context, private repaint: () => void) {
        const target = (width: number) => {
            const data = new Float32Array(width * 4).fill(-1);
            for (let i = 0; i < width; i++) data[i * 4 + 3] = 1;
            const texture = Cogl.Texture2D.new_from_data(context, width, 1,
                Cogl.PixelFormat.RGBA_FP_32323232_PRE, width * 16, new Uint8Array(data.buffer));
            const framebuffer = Cogl.Offscreen.new_with_texture(texture);
            framebuffer.allocate();
            return framebuffer;
        };
        this.probe = target(4);
        this.result = target(1);
        const pipeline = (declarations: string, code: string) => {
            const p = Cogl.Pipeline.new(context);
            p.set_blend('RGBA = ADD (SRC_COLOR, 0)');
            p.set_layer_filters(0, Cogl.PipelineFilter.NEAREST, Cogl.PipelineFilter.NEAREST);
            p.set_layer_wrap_mode(0, Cogl.PipelineWrapMode.CLAMP_TO_EDGE);
            p.add_snippet(Cogl.Snippet.new(Cogl.SnippetHook.FRAGMENT, declarations, code));
            return p;
        };
        this.probePipeline = pipeline(BODY_PROBE_DECLARATIONS, BODY_PROBE_CODE);
        this.validatePipeline = pipeline(BODY_VALIDATE_DECLARATIONS, BODY_VALIDATE_CODE);
        this.validatePipeline.set_layer_texture(1, this.probe.get_texture());
        this.validatePipeline.set_layer_filters(1, Cogl.PipelineFilter.NEAREST, Cogl.PipelineFilter.NEAREST);
        this.validatePipeline.set_layer_combine(1, 'RGBA = REPLACE (PREVIOUS)');
    }

    get texture(): Cogl.Texture { return this.result.get_texture(); }

    updateGeometry(frame: number[], scale: number): void {
        const key = [...frame, scale].join(',');
        if (key === this.geometry) return;
        this.geometry = key;
        if (this.revision > 0) {
            this.pending = false;
            this.retries = 0;
            this.schedule();
        }
    }

    private schedule(): void {
        if (this.timer) GLib.source_remove(this.timer);
        this.timer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 180, () => {
            this.timer = 0;
            this.pending = true;
            this.repaint();
            return GLib.SOURCE_REMOVE;
        });
    }

    render(source: Cogl.Texture, frame: number[], scale: number, origin: number[]): void {
        const identity = new Graphene.Matrix().init_identity();
        for (const [target, pipeline, prefix] of [
            [this.probe, this.probePipeline, 'bodyProbe'],
            [this.result, this.validatePipeline, 'bodyValidate'],
        ] as const) {
            target.set_viewport(0, 0, target.get_width(), 1);
            target.orthographic(0, 0, 1, 1, -1, 1);
            target.set_modelview_matrix(identity);
            pipeline.set_layer_texture(0, source);
            for (const [name, values] of Object.entries({
                Frame: frame, Step: [scale / source.get_width(), scale / source.get_height()],
                Origin: origin, Scale: [scale],
            })) pipeline.set_uniform_float(pipeline.get_uniform_location(prefix + name), values.length, 1, values);
            target.draw_rectangle(pipeline, 0, 0, 1, 1);
            // Submit before a different window can draw or a capture can
            // overwrite the source. flush submits; it does not read/wait.
            target.flush();
            pipeline.set_layer_null_texture(0);
        }
        this.pending = false;
        this.revision++;
        if (this.retries > 0) {
            this.retries--;
            this.schedule();
        }
    }

    dispose(): void {
        if (this.timer) GLib.source_remove(this.timer);
        this.timer = 0;
    }
}
