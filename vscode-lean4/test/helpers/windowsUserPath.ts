import { execFileSync } from 'node:child_process'

// On Windows, the elan installer adds `<ELAN_HOME>\bin` to the PATH of the user
// in the registry (`HKCU\Environment`). The test home cannot isolate the
// registry, so the installer of the network suite changes the real PATH of the
// user. Thus `elan-install.test.ts` saves the value before the installer runs,
// and restores it after the test.
//
// The scripts copy the value from one registry key to another, so that the
// value (for example a user name with non-ASCII letters, or `%USERPROFILE%`)
// does not go through the text output of PowerShell.

// The copy of the value. Not in `HKCU\Environment`: each value there is an
// environment variable.
const SAVE_KEY = String.raw`HKCU:\Software\lean4-vscode-tests\saved-user-path`

function powershell(script: string): void {
    execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { stdio: 'pipe' })
}

// If a copy exists, a run stopped before `restoreWindowsUserPath`. Then the
// current value can already contain the change of the installer, so we keep
// the old copy.
export function saveWindowsUserPath(): void {
    powershell(`
        $ErrorActionPreference = 'Stop'
        $save = '${SAVE_KEY}'
        if (-not (Test-Path $save)) {
            $environment = Get-Item 'HKCU:\\Environment'
            $value = $environment.GetValue('Path', $null, 'DoNotExpandEnvironmentNames')
            $null = New-Item -Path $save -Force
            if ($null -ne $value) {
                $kind = $environment.GetValueKind('Path')
                $null = New-ItemProperty -Path $save -Name Path -Value $value -PropertyType $kind
            }
        }
    `)
}

// Writes the saved value back (or removes the value, if there was none), and
// deletes the copy. Then it tells the other programs (for example Explorer)
// that the environment changed: `SetEnvironmentVariable` with the target
// `User` sends `WM_SETTINGCHANGE`, also for a variable that does not exist.
export function restoreWindowsUserPath(): void {
    powershell(`
        $ErrorActionPreference = 'Stop'
        $save = '${SAVE_KEY}'
        if (Test-Path $save) {
            $saved = Get-Item $save
            $value = $saved.GetValue('Path', $null, 'DoNotExpandEnvironmentNames')
            if ($null -eq $value) {
                Remove-ItemProperty -Path 'HKCU:\\Environment' -Name Path -ErrorAction SilentlyContinue
            } else {
                $kind = $saved.GetValueKind('Path')
                $null = New-ItemProperty -Path 'HKCU:\\Environment' -Name Path -Value $value -PropertyType $kind -Force
            }
            Remove-Item -Path 'HKCU:\\Software\\lean4-vscode-tests' -Recurse
            [Environment]::SetEnvironmentVariable('LEAN4_TEST_UNUSED', $null, 'User')
        }
    `)
}
