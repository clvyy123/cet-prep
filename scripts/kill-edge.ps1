# 只清理本仓库 QA 脚本起的无头 Edge（按 user-data-dir 前缀匹配），不动用户自己的浏览器
$targets = Get-CimInstance Win32_Process -Filter "Name='msedge.exe'" |
    Where-Object { $_.CommandLine -match 'edge-qa-|edge-probe-|edge-ec-' }
$lines = @()
foreach ($t in $targets) {
    $lines += "kill $($t.ProcessId)"
    Stop-Process -Id $t.ProcessId -Force -ErrorAction SilentlyContinue
}
if ($lines.Count -eq 0) { $lines += "no matching headless edge" }
$lines | Set-Content -Encoding UTF8 "E:\词炬\.qa\kill-edge.log"
