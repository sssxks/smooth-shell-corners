import Cogl from 'gi://Cogl';
import Graphene from 'gi://Graphene';
import type {shadowGeometry} from './shadow-geometry.js';
import {textureExtent} from './texture-extent.js';
import {
    BODY_DECLARATIONS,
    EFFECT_SHADOW_MASK_DECLARATIONS, EFFECT_SHADOW_MASK_CODE,
    EFFECT_SHADOW_SPREAD_DECLARATIONS, EFFECT_SHADOW_SPREAD_CODE,
    EFFECT_SHADOW_BLUR_DECLARATIONS, EFFECT_SHADOW_BLUR_CODE,
} from './shaders.js';

// Cache completed tiles, never mutable filter targets. The scratch target is
// shared because shadow baking runs synchronously on the compositor thread.
const shadowCache = new Map<string, Cogl.Texture>();
const SHADOW_CACHE_BYTES = 16 * 1024 * 1024;
let shadowCacheBytes = 0;
export let shadowGeneration = 0;
let shadowScratch: Cogl.Offscreen | null = null;

export function clearShadowCache(): void {
    shadowGeneration++;
    shadowCache.clear();
    shadowCacheBytes = 0;
    shadowScratch = null;
}

export function cacheShadow(key: string, texture: Cogl.Texture): void {
    const bytes = texture.get_width() * texture.get_height() * 4;
    // Oversized styles remain owned by their active pipeline, not the LRU.
    if (bytes > SHADOW_CACHE_BYTES) return;
    shadowCache.set(key, texture);
    shadowCacheBytes += bytes;
    while (shadowCache.size > 16 || shadowCacheBytes > SHADOW_CACHE_BYTES) {
        const oldest = shadowCache.keys().next().value!;
        const removed = shadowCache.get(oldest)!;
        shadowCacheBytes -= removed.get_width() * removed.get_height() * 4;
        shadowCache.delete(oldest);
    }
}

export function cachedShadow(key: string): Cogl.Texture | undefined {
    const texture = shadowCache.get(key);
    if (texture) {
        shadowCache.delete(key);
        shadowCache.set(key, texture);
    }
    return texture;
}

// Each effect owns its baking pipelines through this closure. Dropping it on
// detach or GPU purge releases their textures; only immutable tiles are cached.
export function createShadowBaker(context: Cogl.Context) {
    const coordinateTexture = Cogl.Texture2D.new_with_size(context, 1, 1);
    coordinateTexture.allocate();
    const color = new Cogl.Color();
    color.init_from_4f(1, 1, 1, 1);

    const maskPipeline = Cogl.Pipeline.new(context);
    maskPipeline.set_layer_texture(0, coordinateTexture);
    maskPipeline.set_layer_filters(0, Cogl.PipelineFilter.LINEAR, Cogl.PipelineFilter.LINEAR);
    maskPipeline.set_layer_wrap_mode(0, Cogl.PipelineWrapMode.CLAMP_TO_EDGE);
    maskPipeline.set_color(color);
    maskPipeline.set_blend('RGBA = ADD (SRC_COLOR, DST_COLOR * (1-SRC_COLOR[A]))');
    maskPipeline.add_snippet(Cogl.Snippet.new(Cogl.SnippetHook.FRAGMENT,
        BODY_DECLARATIONS + EFFECT_SHADOW_MASK_DECLARATIONS, EFFECT_SHADOW_MASK_CODE));

    const spreadPipeline = Cogl.Pipeline.new(context);
    spreadPipeline.set_layer_texture(0, coordinateTexture);
    spreadPipeline.set_layer_filters(0, Cogl.PipelineFilter.LINEAR, Cogl.PipelineFilter.LINEAR);
    spreadPipeline.set_layer_wrap_mode(0, Cogl.PipelineWrapMode.CLAMP_TO_EDGE);
    spreadPipeline.set_color(color);
    spreadPipeline.set_blend('RGBA = ADD (SRC_COLOR, 0)');
    spreadPipeline.add_snippet(Cogl.Snippet.new(Cogl.SnippetHook.FRAGMENT,
        EFFECT_SHADOW_SPREAD_DECLARATIONS, EFFECT_SHADOW_SPREAD_CODE));

    const blurPipeline = Cogl.Pipeline.new(context);
    blurPipeline.set_layer_texture(0, coordinateTexture);
    blurPipeline.set_layer_filters(0, Cogl.PipelineFilter.LINEAR, Cogl.PipelineFilter.LINEAR);
    blurPipeline.set_layer_wrap_mode(0, Cogl.PipelineWrapMode.CLAMP_TO_EDGE);
    blurPipeline.set_color(color);
    blurPipeline.set_blend('RGBA = ADD (SRC_COLOR, 0)');
    blurPipeline.add_snippet(Cogl.Snippet.new(Cogl.SnippetHook.FRAGMENT,
        EFFECT_SHADOW_BLUR_DECLARATIONS, EFFECT_SHADOW_BLUR_CODE));

    maskPipeline.set_layer_texture(1, coordinateTexture);
    maskPipeline.set_layer_combine(1, 'RGBA = REPLACE (PREVIOUS)');
    maskPipeline.set_layer_filters(1, Cogl.PipelineFilter.NEAREST, Cogl.PipelineFilter.NEAREST);
    const maskUniforms = {
        effectShadowHole: maskPipeline.get_uniform_location('effectShadowHole'),
        effectShadowHoleRadius: maskPipeline.get_uniform_location('effectShadowHoleRadius'),
        effectShadowExp: maskPipeline.get_uniform_location('effectShadowExp'),
        effectShadowOffset: maskPipeline.get_uniform_location('effectShadowOffset'),
        effectShadowRectOrigin: maskPipeline.get_uniform_location('effectShadowRectOrigin'),
        effectShadowRectSize: maskPipeline.get_uniform_location('effectShadowRectSize'),
    };
    const spreadUniforms = {
        step: spreadPipeline.get_uniform_location('effectShadowSpreadUvStep'),
        pixels: spreadPipeline.get_uniform_location('effectShadowSpreadPixels'),
        textureScale: spreadPipeline.get_uniform_location('effectShadowTextureScale'),
        textureBounds: spreadPipeline.get_uniform_location('effectShadowTextureBounds'),
    };
    const blurUniforms = {
        effectShadowBlurUvStep: blurPipeline.get_uniform_location('effectShadowBlurUvStep'),
        effectShadowBlurPixels: blurPipeline.get_uniform_location('effectShadowBlurPixels'),
        textureScale: blurPipeline.get_uniform_location('effectShadowTextureScale'),
        textureBounds: blurPipeline.get_uniform_location('effectShadowTextureBounds'),
    };

    return (geometry: ReturnType<typeof shadowGeometry>, radius: number, exponent: number,
        blur: number, spread: number, scale: number, bindBody: (pipeline: Cogl.Pipeline) => void): Cogl.Texture | null => {
        const pad = geometry.margin;
        const activeWidth = Math.max(1, Math.ceil((geometry.width + 2 * pad) * scale));
        const activeHeight = Math.max(1, Math.ceil((geometry.height + 2 * pad) * scale));
        const rectWidth = activeWidth / scale, rectHeight = activeHeight / scale;
        let maskFramebuffer: Cogl.Offscreen;
        try {
            maskFramebuffer = Cogl.Offscreen.new_with_texture(
                Cogl.Texture2D.new_with_size(context, activeWidth, activeHeight));
            maskFramebuffer.allocate();
            const width = textureExtent(activeWidth, shadowScratch?.get_width());
            const height = textureExtent(activeHeight, shadowScratch?.get_height());
            if (!shadowScratch || shadowScratch.get_width() !== width || shadowScratch.get_height() !== height) {
                shadowScratch = Cogl.Offscreen.new_with_texture(
                    Cogl.Texture2D.new_with_size(context, width, height));
                shadowScratch.allocate();
            }
        } catch (error) {
            console.error(`[SmoothShellCorners] Could not allocate shadow tile: ${String(error)}`);
            shadowScratch = null;
            return null;
        }
        const blurFramebuffer = shadowScratch;
        const identity = new Graphene.Matrix().init_identity();
        for (const target of [maskFramebuffer, blurFramebuffer]) {
            target.set_viewport(0, 0, activeWidth, activeHeight);
            target.orthographic(-pad, -pad,
                rectWidth - pad, rectHeight - pad, -1, 1);
            target.set_modelview_matrix(identity);
            target.clear4f(Cogl.BufferBit.COLOR, 0, 0, 0, 0);
        }

        // Each input may have different capacity (exact tile vs scratch).
        const bind = (pipeline: Cogl.Pipeline, uniforms: Record<string, number>, texture: Cogl.Texture) => {
            const width = texture.get_width(), height = texture.get_height();
            pipeline.set_layer_texture(0, texture);
            pipeline.set_uniform_float(uniforms.textureScale, 2, 1,
                [activeWidth / width, activeHeight / height]);
            pipeline.set_uniform_float(uniforms.textureBounds, 4, 1,
                [0.5 / width, 0.5 / height, (activeWidth - 0.5) / width, (activeHeight - 0.5) / height]);
        };
        bindBody(maskPipeline);
        maskPipeline.set_uniform_float(maskUniforms.effectShadowHole, 4, 1,
            [0, 0, geometry.width, geometry.height]);
        maskPipeline.set_uniform_float(maskUniforms.effectShadowHoleRadius, 1, 1,
            [radius]);
        maskPipeline.set_uniform_float(maskUniforms.effectShadowExp, 1, 1, [exponent]);
        maskPipeline.set_uniform_float(maskUniforms.effectShadowOffset, 2, 1, [0, 0]);
        maskPipeline.set_uniform_float(maskUniforms.effectShadowRectOrigin, 2, 1,
            [-pad, -pad]);
        maskPipeline.set_uniform_float(maskUniforms.effectShadowRectSize, 2, 1,
            [rectWidth, rectHeight]);
        maskFramebuffer.draw_rectangle(maskPipeline, -pad, -pad,
            rectWidth - pad, rectHeight - pad);

        // Ping-pong both filters through the existing pair of targets.
        // Overwrite blending is required because each target is reused.
        // Cogl queues rectangles. Submit each consumer before overwriting
        // its input, otherwise the journals acquire circular dependencies
        // and spread can disappear. flush() does not wait for GPU completion.
        if (spread !== 0) {
            bind(spreadPipeline, spreadUniforms, maskFramebuffer.get_texture());
            spreadPipeline.set_uniform_float(spreadUniforms.step, 2, 1, [1 / activeWidth, 0]);
            spreadPipeline.set_uniform_float(spreadUniforms.pixels, 1, 1,
                [spread * scale]);
            blurFramebuffer.draw_rectangle(spreadPipeline, -pad, -pad,
                rectWidth - pad, rectHeight - pad);
            blurFramebuffer.flush();
            bind(spreadPipeline, spreadUniforms, blurFramebuffer.get_texture());
            spreadPipeline.set_uniform_float(spreadUniforms.step, 2, 1, [0, 1 / activeHeight]);
            spreadPipeline.set_uniform_float(spreadUniforms.pixels, 1, 1,
                [spread * scale]);
            maskFramebuffer.draw_rectangle(spreadPipeline, -pad, -pad,
                rectWidth - pad, rectHeight - pad);
            if (blur > 0) maskFramebuffer.flush();
        }
        if (blur > 0) {
            bind(blurPipeline, blurUniforms, maskFramebuffer.get_texture());
            blurPipeline.set_uniform_float(blurUniforms.effectShadowBlurUvStep, 2, 1,
                [1 / activeWidth, 0]);
            blurPipeline.set_uniform_float(blurUniforms.effectShadowBlurPixels, 1, 1,
                [blur * scale]);
            blurFramebuffer.draw_rectangle(blurPipeline, -pad, -pad,
                rectWidth - pad, rectHeight - pad);
            blurFramebuffer.flush();
            bind(blurPipeline, blurUniforms, blurFramebuffer.get_texture());
            blurPipeline.set_uniform_float(blurUniforms.effectShadowBlurUvStep, 2, 1,
                [0, 1 / activeHeight]);
            blurPipeline.set_uniform_float(blurUniforms.effectShadowBlurPixels, 1, 1,
                [blur * scale]);
            maskFramebuffer.draw_rectangle(blurPipeline, -pad, -pad,
                rectWidth - pad, rectHeight - pad);
        }
        // Submit consumers before reusing shared scratch for another tile.
        maskFramebuffer.flush();
        spreadPipeline.set_layer_null_texture(0);
        blurPipeline.set_layer_null_texture(0);
        return maskFramebuffer.get_texture();
    };
}
