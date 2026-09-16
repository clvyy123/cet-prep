# 只停掉跑 import-all-papers 的 node 进程（按命令行匹配），不动别的
$targets = Get-CimInstance Win32_Process -Filter "Name='node.exe'" |
    Where-Object { $_.CommandLine -match 'import-all-papers' }
$lines = @()
foreach ($t in $targets) {
    $lines += "kill node $($t.ProcessId)"
    Stop-Process -Id $t.ProcessId -Force -ErrorAction SilentlyContinue
}
if ($lines.Count -eq 0) { $lines += "no matching node" }
$lines | Set-Content -Encoding UTF8 "E:\词炬\.qa\kill-node.log"
