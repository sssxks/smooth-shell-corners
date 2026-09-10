//! Bazzite/GNOME 50 EGL interposer. No Cogl flushes or synchronous query reads.
use std::{
    cell::RefCell,
    collections::{HashMap, VecDeque},
    ffi::{CStr, c_char, c_void},
    fs::{File, OpenOptions},
    io::Write,
    sync::{Mutex, OnceLock},
};

unsafe extern "C" {
    fn dlsym(handle: *mut c_void, symbol: *const c_char) -> *mut c_void;
    fn clock_gettime(clock: i32, value: *mut i64) -> i32;
}
type Proc = unsafe extern "C" fn(*const c_char) -> *mut c_void;
fn resolver() -> Proc {
    static ADDRESS: OnceLock<usize> = OnceLock::new();
    unsafe {
        std::mem::transmute(*ADDRESS.get_or_init(|| {
            let p = dlsym(-1isize as *mut c_void, c"eglGetProcAddress".as_ptr());
            assert!(!p.is_null(), "GPU timer: EGL resolver missing");
            p as usize
        }))
    }
}
macro_rules! gl {
    ($name:literal, $ty:ty) => {{
        static ADDRESS: OnceLock<usize> = OnceLock::new();
        #[allow(unused_unsafe)]
        unsafe {
            std::mem::transmute::<usize, $ty>(*ADDRESS.get_or_init(|| {
                let p = resolver()(concat!($name, "\0").as_ptr().cast());
                assert!(!p.is_null(), "GPU timer: missing {}", $name);
                p as usize
            }))
        }
    }};
}
fn context() -> usize {
    static ADDRESS: OnceLock<usize> = OnceLock::new();
    let f: unsafe extern "C" fn() -> *mut c_void = unsafe {
        std::mem::transmute(*ADDRESS.get_or_init(|| {
            dlsym(-1isize as *mut c_void, c"eglGetCurrentContext".as_ptr()) as usize
        }))
    };
    unsafe { f() as usize }
}
fn now() -> i64 {
    let mut t = [0i64; 2];
    unsafe {
        clock_gettime(1, t.as_mut_ptr());
    }
    t[0] * 1_000_000_000 + t[1]
}
fn output(line: &str) {
    static FILE: OnceLock<Mutex<File>> = OnceLock::new();
    let file = FILE.get_or_init(|| {
        Mutex::new(
            OpenOptions::new()
                .create(true)
                .append(true)
                .open(std::env::var("SSC_GPU_TRACE").expect("SSC_GPU_TRACE missing"))
                .unwrap(),
        )
    });
    file.lock().unwrap().write_all(line.as_bytes()).unwrap();
}
struct Pending {
    ids: [u32; 2],
    cpu: i64,
    program: u32,
    label: &'static str,
    width: i32,
    height: i32,
}
#[derive(Default)]
struct Context {
    pending: VecDeque<Pending>,
    pool: Vec<[u32; 2]>,
    programs: HashMap<u32, (&'static str, i32)>,
}
thread_local! { static CONTEXTS: RefCell<HashMap<usize, Context>> = RefCell::new(HashMap::new()); }
impl Context {
    fn drain(&mut self, ctx: usize) {
        let available = gl!(
            "glGetQueryObjectiv",
            unsafe extern "C" fn(u32, u32, *mut i32)
        );
        let result = gl!(
            "glGetQueryObjectui64v",
            unsafe extern "C" fn(u32, u32, *mut u64)
        );
        let mut batch = String::new();
        while let Some(p) = self.pending.front() {
            let mut ready = 0;
            unsafe {
                available(p.ids[1], 0x8867, &mut ready);
            }
            if ready == 0 {
                break;
            }
            let p = self.pending.pop_front().unwrap();
            let (mut start, mut end) = (0, 0);
            unsafe {
                result(p.ids[0], 0x8866, &mut start);
                result(p.ids[1], 0x8866, &mut end);
            }
            assert!(end >= start, "GPU timer: timestamp moved backwards");
            batch.push_str(&format!(
                "{},{},{},{},{},{},{}\n",
                p.cpu,
                ctx,
                p.program,
                p.label,
                p.width,
                p.height,
                end - start
            ));
            self.pool.push(p.ids);
        }
        if !batch.is_empty() {
            output(&batch);
        }
    }
    fn classify(&mut self, program: u32) -> &'static str {
        let location = gl!(
            "glGetUniformLocation",
            unsafe extern "C" fn(u32, *const c_char) -> i32
        );
        let (label, axis) = *self.programs.entry(program).or_insert_with(|| {
            for (name, label, directional) in [
                (c"bodyProbeFrame", "body-probe", false),
                (c"bodyValidateFrame", "body-validate", false),
                (c"effectShadowBlurUvStep", "blur", true),
                (c"effectShadowSpreadUvStep", "spread", true),
                (c"effectShadowHole", "mask", false),
                (c"effectShadowOpacity", "shadow-composite", false),
                (c"clipRadius", "window", false),
                (c"shadowStep", "legacy-shadow", false),
            ] {
                let loc = unsafe { location(program, name.as_ptr()) };
                if loc >= 0 {
                    return (label, if directional { loc } else { -1 });
                }
            }
            ("other", -1)
        });
        if axis < 0 {
            return label;
        }
        let mut value = [0.0f32; 2];
        unsafe {
            gl!("glGetUniformfv", unsafe extern "C" fn(u32, i32, *mut f32))(
                program,
                axis,
                value.as_mut_ptr(),
            );
        }
        match (label, value[0] != 0.0) {
            ("blur", true) => "blur-x",
            ("blur", false) => "blur-y",
            (_, true) => "spread-x",
            (_, false) => "spread-y",
        }
    }
}
fn timed(label: Option<&'static str>, draw: impl FnOnce()) {
    let ctx = context();
    if ctx == 0 {
        draw();
        return;
    }
    let stamp = gl!("glQueryCounter", unsafe extern "C" fn(u32, u32));
    let p = CONTEXTS.with(|all| {
        let mut all = all.borrow_mut();
        let state = all.entry(ctx).or_insert_with(|| {
            let mut bits = 0;
            unsafe {
                gl!("glGetQueryiv", unsafe extern "C" fn(u32, u32, *mut i32))(
                    0x8e28, 0x8864, &mut bits,
                );
            }
            assert!(bits > 0, "GPU timer: timestamps unsupported");
            let renderer = unsafe {
                CStr::from_ptr(gl!(
                    "glGetString",
                    unsafe extern "C" fn(u32) -> *const c_char
                )(0x1f01))
            };
            eprintln!("SSC GPU timer: context={ctx} timestamp_bits={bits} renderer={renderer:?}");
            Context::default()
        });
        state.drain(ctx);
        assert!(
            state.pending.len() < 4096,
            "GPU timer: query backlog overflow"
        );
        let ids = state.pool.pop().unwrap_or_else(|| {
            let mut ids = [0; 2];
            unsafe {
                gl!("glGenQueries", unsafe extern "C" fn(i32, *mut u32))(2, ids.as_mut_ptr());
            }
            ids
        });
        let get = gl!("glGetIntegerv", unsafe extern "C" fn(u32, *mut i32));
        let mut program = 0;
        let mut viewport = [0i32; 4];
        unsafe {
            get(0x8b8d, &mut program);
            get(0x0ba2, viewport.as_mut_ptr());
        }
        Pending {
            ids,
            cpu: now(),
            program: program as u32,
            label: label.unwrap_or_else(|| state.classify(program as u32)),
            width: viewport[2],
            height: viewport[3],
        }
    });
    unsafe {
        stamp(p.ids[0], 0x8e28);
    }
    draw();
    unsafe {
        stamp(p.ids[1], 0x8e28);
    }
    CONTEXTS.with(|all| all.borrow_mut().get_mut(&ctx).unwrap().pending.push_back(p));
}
#[unsafe(no_mangle)]
pub unsafe extern "C" fn glDrawArrays(mode: u32, first: i32, count: i32) {
    let f = gl!("glDrawArrays", unsafe extern "C" fn(u32, i32, i32));
    timed(None, || unsafe { f(mode, first, count) });
}
#[unsafe(no_mangle)]
pub unsafe extern "C" fn glDrawElements(mode: u32, count: i32, ty: u32, indices: *const c_void) {
    let f = gl!(
        "glDrawElements",
        unsafe extern "C" fn(u32, i32, u32, *const c_void)
    );
    timed(None, || unsafe { f(mode, count, ty, indices) });
}
#[unsafe(no_mangle)]
pub unsafe extern "C" fn glClear(mask: u32) {
    let f = gl!("glClear", unsafe extern "C" fn(u32));
    timed(Some("clear"), || unsafe { f(mask) });
}
#[unsafe(no_mangle)]
pub unsafe extern "C" fn glBlitFramebuffer(
    x0: i32,
    y0: i32,
    x1: i32,
    y1: i32,
    a0: i32,
    b0: i32,
    a1: i32,
    b1: i32,
    mask: u32,
    filter: u32,
) {
    let f = gl!(
        "glBlitFramebuffer",
        unsafe extern "C" fn(i32, i32, i32, i32, i32, i32, i32, i32, u32, u32)
    );
    timed(Some("blit"), || unsafe {
        f(x0, y0, x1, y1, a0, b0, a1, b1, mask, filter)
    });
}
#[unsafe(no_mangle)]
pub unsafe extern "C" fn glDeleteProgram(program: u32) {
    CONTEXTS.with(|all| {
        if let Some(state) = all.borrow_mut().get_mut(&context()) {
            state.programs.remove(&program);
        }
    });
    unsafe {
        gl!("glDeleteProgram", unsafe extern "C" fn(u32))(program);
    }
}
#[unsafe(no_mangle)]
pub unsafe extern "C" fn glFlush() {
    unsafe {
        gl!("glFlush", unsafe extern "C" fn())();
    }
    CONTEXTS.with(|all| {
        if let Some(state) = all.borrow_mut().get_mut(&context()) {
            state.drain(context());
        }
    });
}
#[unsafe(no_mangle)]
pub unsafe extern "C" fn eglGetProcAddress(name: *const c_char) -> *mut c_void {
    match unsafe { CStr::from_ptr(name) }.to_bytes() {
        b"glDrawArrays" => glDrawArrays as *mut c_void,
        b"glDrawElements" => glDrawElements as *mut c_void,
        b"glClear" => glClear as *mut c_void,
        b"glBlitFramebuffer" => glBlitFramebuffer as *mut c_void,
        b"glDeleteProgram" => glDeleteProgram as *mut c_void,
        b"glFlush" => glFlush as *mut c_void,
        _ => unsafe { resolver()(name) },
    }
}
