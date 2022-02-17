function postFixup(theme) {
    try {
        var html = document.querySelector('html');
        html.classList.remove('no-js')
        html.classList.remove('light')
        html.classList.add(theme);
        html.classList.add('js');
    }
    catch (e) {
    }
}

var currentTheme = '';

function applyTheme(newTheme) {
    var prefix = 'vscode-';
    if (newTheme.startsWith(prefix)) {
        // strip prefix
        newTheme = newTheme.substr(prefix.length);
    }

    if (newTheme === 'high-contrast' || // our books don't support high contrast yet.
        newTheme === 'dark') {
        newTheme = 'coal';
    } else {
        newTheme = 'light';
    }

    if (newTheme !== currentTheme) {
        currentTheme = newTheme;
        console.log('Applying book theme: ' + newTheme);
        set_theme(newTheme);    // call into book.js.
        postFixup(newTheme);
    }
}

function vsCodeThemeWatcher() {
    applyTheme(document.body.className);

    var observer = new MutationObserver(function(mutations) {
        mutations.forEach(function(mutationRecord) {
            console.log('Detected vscode theme change: ' + mutationRecord.target.className);
            applyTheme(mutationRecord.target.className);
        });
    });

    var target = document.body;
    observer.observe(target, { attributes : true, attributeFilter : ['class'] });

    // since page was reloaded, scroll back to the top of the document.
    window.scrollTo(0, 0);
}

window.addEventListener('load', vsCodeThemeWatcher);
