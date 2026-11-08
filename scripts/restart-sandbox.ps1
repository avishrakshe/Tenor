# Local helper: restarts the WSL sandbox in the background.
wsl.exe -d Ubuntu -- bash -c "pkill -f near-sandbox-bin; sleep 1"
Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object { $_.CommandLine -like '*scripts/sandbox.mjs*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }
Start-Process -FilePath node -ArgumentList 'scripts/sandbox.mjs' -WorkingDirectory $PSScriptRoot\.. -RedirectStandardOutput D:\.tenor-rust\sandbox.log -RedirectStandardError D:\.tenor-rust\sandbox.err -WindowStyle Hidden
Start-Sleep 10
(Invoke-RestMethod -Uri http://127.0.0.1:3030/status -TimeoutSec 8).version.version
