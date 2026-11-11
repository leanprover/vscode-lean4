# Installation scripts

The extension installs Elan with these scripts:

- `elan-install/install-windows.ps1`
- `elan-install/install-unix.sh`

The CI action `setup-elan` (`.github/actions/setup-elan/action.yml`) runs the same scripts. The scripts that install Git on Windows and the Apple Command Line Tools on macOS are in `src/utils/depInstaller.ts`.

Users see these scripts. The output channel "Lean: Editor" shows each script that the extension runs. If the installation of Elan fails, an error shows a manual script, which the user can paste into a terminal. Thus the scripts have no comments, and this file has the notes about them. An interactive zsh also does not accept comments.

## The proxy credentials on Windows

The two Windows scripts start with the same lines for the proxy credentials. In `elan-install/install-windows.ps1`, the lines are the start of the script block. In `src/utils/depInstaller.ts`, they are the start of the Git script. A change to these lines must be made in the two scripts. `test/unit/windowsProxyCredentials.test.ts` makes sure that the lines are the same, and that they come before the first download.

The extension starts PowerShell without the profiles of the user (`-NoProfile`), so no profile can set the credentials for a proxy. If a proxy needs a login, the downloads give it the Windows credentials of the user. Without a proxy, or with credentials from a profile, the lines have no effect.

On computers with AppLocker or WDAC, PowerShell can run in ConstrainedLanguage mode. This mode blocks the .NET members in the lines. Thus the scripts skip the lines in this mode. Else the output of the installation starts with an error, and the user can think that the proxy is the cause. `elan-init.ps1` does the same check.

## `elan-install/install-windows.ps1`

- A user can paste this script into a terminal (`manualScript` in `src/utils/leanInstaller.ts`). There, `exit` closes the terminal. Thus a failure ends the script with `throw`. In a terminal, PowerShell shows the error, and `powershell -Command` ends with exit code 1.
- The manual script must not change the PowerShell session of the user. Thus the script runs in a script block (`& { ... }`). `$ProgressPreference` and the variables of the script stay in the scope of the script block. A `throw` in the script block ends the script as before.
- `Expand-Archive` in `elan-init.ps1` loads a script module. Thus the extension and the CI action start Windows PowerShell with the execution policy `Bypass`. In a terminal, the manual script must set this policy itself. It puts this script into a second script block (`windowsManualScript` in `src/utils/leanInstaller.ts`). This block sets `Bypass` for the process. At the end, also after a `throw`, it sets the old policy of the process again (`finally`).
- The script block does not keep the proxy credentials in its scope. `DefaultWebProxy` is an object of the process, so its credentials stay set after the script. Later downloads in the session then also give the Windows credentials to the proxy.
- With a progress display, `Invoke-WebRequest` of Windows PowerShell 5.1 downloads much more slowly. Thus the script sets `$ProgressPreference` to `SilentlyContinue`. `elan-init.ps1` also downloads Elan with `Invoke-WebRequest`. It runs in a child scope of the script block, so it uses this value too.
- ConstrainedLanguage mode permits method calls only on a small set of types. Thus `[ScriptBlock]::Create` and `GetString` fail in this mode. There, the script puts the text of `elan-init.ps1` between `{` and `}`, and `Invoke-Expression` returns this text as a script block. The line that runs the installer is the same in the two modes. The script block is not a file, so the execution policy does not apply to it.
- In ConstrainedLanguage mode, the script also decodes the bytes of `elan-init.ps1` as UTF-8. `[uri]` is one of the types on which this mode permits method calls. Thus the script writes each byte as `%XX`, and `[uri]::UnescapeDataString` decodes this text as UTF-8.
- `test/unit/elanInstallLanguageModes.test.ts` runs the script in the two modes, with a stub for `elan-init.ps1`. The stub contains characters that are not ASCII. The test uses PowerShell 7 and, on Windows, also Windows PowerShell.
- `elan-init.ps1` returns 0 or 1. The script uses only the last output of `elan-init.ps1` (`Select-Object -Last 1`). We do not pin `elan-init.ps1`, and a later version can write more objects to the pipeline. Then `$rc` is an array, and `$rc -ne 0` is true when the array contains a value other than 0.

## `elan-install/install-unix.sh`

The script does not set `pipefail`, because the manual script must not change the shell of the user. The extension and the CI action set it (`elanInstallationMethod` in `src/utils/leanInstaller.ts`).

## The script for the Apple Command Line Tools on macOS

The extension runs this script with `set -e` (`dependencyInstallationMethod` in `src/utils/depInstaller.ts`). The manual script (`manualBackupScript`) does not set the option. A user pastes the manual script into a terminal. There, the option stays set after the script, and the shell exits at the next command that fails. For the same reason, the script in `media/guide-installLean-mac.md` does not contain `set -e`.

## The default toolchain

The Elan scripts contain the default toolchain as text, and not the value of `elanStableChannel` in `src/utils/elan.ts`. `test/unit/elanInstallScripts.test.ts` makes sure that the two values are the same.
