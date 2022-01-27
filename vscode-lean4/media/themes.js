var theme = '${theme}';
default_theme = theme;
window.clip_buttons = false;
window.tryit_buttons = true;
window.default_theme = theme;
window.side_bar = false;

function setTheme(theme) {
    try {
        var html = document.querySelector('html');
        html.classList.remove('no-js')
        html.classList.remove('light')
        html.classList.add(theme);
        html.classList.add('js');
        localStorage.setItem('mdbook-theme', theme);
    }
    catch (e) {
    }
}

window.matchMedia("(prefers-color-scheme: dark)").addListener(
    e => {
        var theme = e.matches ? 'coal' : 'light';
        console.log('prefers-color-scheme changed to ' + theme);
        setTheme(theme);
    }
);

setTheme(theme)

console.log("Setting theme: " + theme);
