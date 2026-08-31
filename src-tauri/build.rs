#[cfg(windows)]
const COMMON_CONTROLS: &str = "cargo:rustc-link-arg=/MANIFESTDEPENDENCY:type='win32' name='Microsoft.Windows.Common-Controls' version='6.0.0.0' processorArchitecture='*' publicKeyToken='6595b64144ccf1df' language='*'";

fn main() {
    #[cfg(windows)]
    println!("{COMMON_CONTROLS}");

    tauri_build::build()
}
