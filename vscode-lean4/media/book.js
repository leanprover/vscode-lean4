var docView = acquireVsCodeApi();

function setupCodeSnippets() {
    if (window.playground_copyable) {
        Array.from(document.querySelectorAll('pre code')).forEach(function (block) {
            var pre_block = block.parentNode;
            if (!pre_block.classList.contains('playground')) {
                var buttons = pre_block.querySelector(".buttons");
                if (!buttons) {
                    buttons = document.createElement('div');
                    buttons.className = 'buttons';
                    pre_block.insertBefore(buttons, pre_block.firstChild);
                }

                var tryItButton = document.createElement('button');
                tryItButton.className = 'fa fa-copy clip-button';
                tryItButton.innerHTML = '<i class="tooltiptext"></i>';
                tryItButton.title = 'Try it';
                tryItButton.setAttribute('aria-label', tryItButton.title);
                buttons.insertBefore(tryItButton, buttons.firstChild);
            }
        });
    }

    // Process playground code blocks
    Array.from(document.querySelectorAll(".playground")).forEach(function (pre_block) {
        // Add play button
        var buttons = pre_block.querySelector(".buttons");
        if (!buttons) {
            buttons = document.createElement('div');
            buttons.className = 'buttons';
            pre_block.insertBefore(buttons, pre_block.firstChild);
        }

        var runCodeButton = document.createElement('button');
        runCodeButton.className = 'fa fa-play play-button';
        runCodeButton.hidden = true;
        runCodeButton.title = 'Run this code';
        runCodeButton.setAttribute('aria-label', runCodeButton.title);

        buttons.insertBefore(runCodeButton, buttons.firstChild);
        runCodeButton.addEventListener('click', function (e) {
            run_rust_code(pre_block);
        });

        if (window.playground_copyable) {
            var tryItButton = document.createElement('button');
            tryItButton.className = 'fa fa-copy clip-button';
            tryItButton.innerHTML = '<i class="tooltiptext"></i>';
            tryItButton.title = 'Try it';
            tryItButton.setAttribute('aria-label', tryItButton.title);
            buttons.insertBefore(tryItButton, buttons.firstChild);
        }
    });
}

function setupSyntaxHighlighting() {

    if (typeof hljs === 'undefined') return;

    // Syntax highlighting Configuration
    hljs.configure({
        tabReplace: '    ', // 4 spaces
        languages: [],      // Languages used for auto-detection
    });

    let code_nodes = Array
        .from(document.querySelectorAll('code'))
        // Don't highlight `inline code` blocks in headers.
        .filter(function (node) {return !node.parentElement.classList.contains("header"); });

    if (window.ace) {
        // language-rust class needs to be removed for editable
        // blocks or highlightjs will capture events
        Array
            .from(document.querySelectorAll('code.editable'))
            .forEach(function (block) { block.classList.remove('language-rust'); });

        Array
            .from(document.querySelectorAll('code:not(.editable)'))
            .forEach(function (block) { hljs.highlightBlock(block); });
    } else {
        code_nodes.forEach(function (block) { hljs.highlightBlock(block); });
    }

    // Adding the hljs class gives code blocks the color css
    // even if highlighting doesn't apply
    code_nodes.forEach(function (block) { block.classList.add('hljs'); });

    Array.from(document.querySelectorAll("code.hljs")).forEach(function (block) {

        var lines = Array.from(block.querySelectorAll('.boring'));
        // If no lines were hidden, return
        if (!lines.length) { return; }
        block.classList.add("hide-boring");

        var buttons = document.createElement('div');
        buttons.className = 'buttons';
        buttons.innerHTML = "<button class=\"fa fa-eye\" title=\"Show hidden lines\" aria-label=\"Show hidden lines\"></button>";

        // add expand button
        var pre_block = block.parentNode;
        pre_block.insertBefore(buttons, pre_block.firstChild);

        pre_block.querySelector('.buttons').addEventListener('click', function (e) {
            if (e.target.classList.contains('fa-eye')) {
                e.target.classList.remove('fa-eye');
                e.target.classList.add('fa-eye-slash');
                e.target.title = 'Hide lines';
                e.target.setAttribute('aria-label', e.target.title);

                block.classList.remove('hide-boring');
            } else if (e.target.classList.contains('fa-eye-slash')) {
                e.target.classList.remove('fa-eye-slash');
                e.target.classList.add('fa-eye');
                e.target.title = 'Show hidden lines';
                e.target.setAttribute('aria-label', e.target.title);

                block.classList.add('hide-boring');
            }
        });
    });
}

function set_theme(theme) {
    var stylesheets = {
        ayuHighlight: document.querySelector("[href$='ayu-highlight.css']"),
        tomorrowNight: document.querySelector("[href$='tomorrow-night.css']"),
        highlight: document.querySelector("[href$='highlight.css']"),
    };

    var themeColorMetaTag = document.querySelector('meta[name="theme-color"]');

    if (stylesheets.ayuHighlight === null){
        return; // not a themed page then.
    }

    if (theme == 'coal' || theme == 'navy') {
        console.log('setting theme to coal, enabling ' + stylesheets.ayuHighlight);
        stylesheets.ayuHighlight.disabled = true;
        stylesheets.tomorrowNight.disabled = false;
        stylesheets.highlight.disabled = true;
    } else if (theme == 'ayu') {
        stylesheets.ayuHighlight.disabled = false;
        stylesheets.tomorrowNight.disabled = true;
        stylesheets.highlight.disabled = true;
    } else {
        console.log('setting theme to light, enabling ' + stylesheets.highlight);
        stylesheets.ayuHighlight.disabled = true;
        stylesheets.tomorrowNight.disabled = true;
        stylesheets.highlight.disabled = false;
    }
    if (themeColorMetaTag) {
        setTimeout(function () {
            themeColorMetaTag.content = getComputedStyle(document.body).backgroundColor;
        }, 1);
    }
}

function setupTryItButtons() {
    var clipButtons = document.querySelectorAll('.clip-button');

    function hideTooltip(elem) {
        elem.firstChild.innerText = "";
        elem.className = 'fa fa-copy clip-button';
    }

    Array.from(clipButtons).forEach(function (clipButton) {
        clipButton.addEventListener('mouseout', function (e) {
            hideTooltip(e.currentTarget);
        });
        clipButton.addEventListener('click', function (e) {
            console.log('clicked tryit button')
            e.preventDefault();
            const name = 'tryit';
            const playground = clipButton.parentElement.parentElement;
            const code_block = playground.querySelector('code');
            const contents = code_block?.textContent;
            docView.postMessage({name, contents});
        })
    });

};

var default_theme = null;
var loaded = false;

window.addEventListener('load', () => {
    setupSyntaxHighlighting();
    setupCodeSnippets();
    setupTryItButtons();
    if (default_theme) {
        set_theme(default_theme);
    }
    loaded = true;
});

function receiveMessage(e){
    const message = e.data;
    if (message.theme){
        var theme = message.theme;
        console.log("received theme: " + theme);
        default_theme = theme === 'dark' ? 'coal' : 'light';
        if (loaded) {
            set_theme(default_theme);
        }
    }
}

window.addEventListener('message', e => receiveMessage(e));
