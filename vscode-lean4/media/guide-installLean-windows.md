## Installed Components
The following components are automatically installed when clicking [this link](command:lean4.setup.installLean) or the 'Install Lean' button associated with this step:
- [Elan](https://github.com/leanprover/elan) is Lean's version manager and automatically manages all the different versions of Lean and ensures that the correct version is used when opening a project.
- [Git](https://git-scm.com/) is a commonly used [Version Control System](https://en.wikipedia.org/wiki/Version_control) that is used by Lean to help manage different versions of Lean formalization packages and software packages. It can also be used to collaborate on Lean projects.

Components that are already installed will be skipped.

## Installation Procedure Details
The automatic installation will run a script to install Elan and Git. 

On newer Windows systems that support the package manager [winget](https://learn.microsoft.com/en-us/windows/package-manager/winget/), the following script will be executed:
```powershell
# Install Git using `winget`.
winget install -e --id Git.Git --silent --accept-package-agreements --accept-source-agreements --disable-interactivity
# Download the Elan installation script at https://github.com/leanprover/elan/blob/master/elan-init.ps1 and run it. Elan will be installed to `%USERPROFILE%\.elan`.
$installCode = (Invoke-WebRequest -Uri "https://elan.lean-lang.org/elan-init.ps1" -UseBasicParsing -ErrorAction Stop).Content
$installer = [ScriptBlock]::Create([System.Text.Encoding]::UTF8.GetString($installCode))
Set-ExecutionPolicy -ExecutionPolicy Unrestricted -Scope Process
& $installer -NoPrompt 1 -DefaultToolchain ${elanStableChannel}
```

On older Windows systems that do not support the package manager [winget](https://learn.microsoft.com/en-us/windows/package-manager/winget/), the following script will be executed instead:
```powershell
# Install Git by downloading the installer from https://github.com/git-for-windows/git/releases/download/v2.50.1.windows.1/Git-2.50.1-64-bit.exe and running it.
$gitInstallerUrl = "https://github.com/git-for-windows/git/releases/download/v2.50.1.windows.1/Git-2.50.1-64-bit.exe"
$installDir = "%TEMP%\lean4-vscode-extension"
$gitInstallerLoc = "$installDir\GitInstaller.exe"
New-Item -ItemType Directory -Path $installDir -Force
Invoke-WebRequest -Uri $gitInstallerUrl -OutFile $gitInstallerLoc
& $gitInstallerLoc /VERYSILENT /NORESTART /SP-
# Download the Elan installation script at https://github.com/leanprover/elan/blob/master/elan-init.ps1 and run it. Elan will be installed to `%USERPROFILE%\.elan`.
$installCode = (Invoke-WebRequest -Uri "https://elan.lean-lang.org/elan-init.ps1" -UseBasicParsing -ErrorAction Stop).Content
$installer = [ScriptBlock]::Create([System.Text.Encoding]::UTF8.GetString($installCode))
Set-ExecutionPolicy -ExecutionPolicy Unrestricted -Scope Process
& $installer -NoPrompt 1 -DefaultToolchain ${elanStableChannel}
```

## Restricted Environments
If you are in a restricted environment where you cannot install Git or curl and they are not already installed, for example a restricted university computer, then the installation script above may fail. In this case, there is currently no way to try Lean 4 with a local installation. If you want to try out Lean 4 regardless, you can read [Mathematics in Lean](https://leanprover-community.github.io/mathematics_in_lean/) and do the exercises with [an online instance of Lean 4 hosted using Gitpod](https://gitpod.io/#/https://github.com/leanprover-community/mathematics_in_lean). Doing so requires creating a GitHub account. Alternatively, you can also [play the Natural Number Game](https://adam.math.hhu.de/#/g/hhu-adam/NNG4) or [try a single-file version of Lean 4 in your web browser](https://live.lean-lang.org/).
