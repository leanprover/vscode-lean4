## Installing Required Dependencies
1. [Open a new terminal](command:workbench.action.terminal.new).
2. Type in `/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"` and press Enter to install [Homebrew](https://brew.sh/), a package manager for macOS.
3. Follow the instructions in the terminal.
4. Type in `brew install curl git` and press Enter.
5. Wait until the installation has completed.

## Dependencies Needed by Lean 4
[Git](https://git-scm.com/) is a commonly used [Version Control System](https://en.wikipedia.org/wiki/Version_control) that is used by Lean to help manage different versions of Lean formalization packages and software packages.

[curl](https://curl.se/) is a small tool to transfer data that is used by Lean to download files when managing Lean formalization packages and software packages.

## Restricted Environments
If you are in an environment where you cannot install Homebrew, Git or curl, for example a restricted university computer, you can check if you already have them installed by [opening a new terminal](command:workbench.action.terminal.new), typing in `which git curl` and pressing Enter. If the terminal output displays two file paths and no error, you already have them installed.  

If your machine does not already have Homebrew, Git and curl installed and you cannot install them, there is currently no option to try Lean 4 with a local installation. If you want to try out Lean 4 regardless, you can read [Mathematics in Lean](https://leanprover-community.github.io/mathematics_in_lean/) and do the exercises with [an online instance of Lean 4 hosted using Gitpod](https://gitpod.io/#/https://github.com/leanprover-community/mathematics_in_lean). Doing so requires creating a GitHub account. Alternatively, you can also [play the Natural Number Game](https://adam.math.hhu.de/#/g/hhu-adam/NNG4) or [try a single-file version of Lean 4 in your web browser](https://live.lean-lang.org/).
