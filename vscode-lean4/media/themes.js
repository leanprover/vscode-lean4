var theme = '${theme}';
window.clip_buttons = false;
window.tryit_buttons = true;
window.default_theme = theme;
window.side_bar = false;

function setTheme(theme) {
    try {
        localStorage.setItem('mdbook-theme', theme);
    }
    catch (e) {
    }
}

window.matchMedia("(prefers-color-scheme: dark)").addListener(
    e => {
        setTheme(e.matches ? 'coal' : 'light');
    }
);

setTheme(theme);
