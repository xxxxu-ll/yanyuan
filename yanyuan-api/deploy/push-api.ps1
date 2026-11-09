# 通过 GitHub REST API 推送目录（PowerShell 版：本机 Node 的 fetch 到 api.github.com 不稳定）
param(
  [Parameter(Mandatory=$true)][string]$Dir,
  [Parameter(Mandatory=$true)][string]$Repo,
  [string]$Branch = "main",
  [string]$Prefix = "",
  [string]$Message = "像素燕园 v1：全校像素地图、多人在线、服务端存档"
)

$ErrorActionPreference = "Stop"
$git = "C:\Users\徐若凯\AppData\Local\GitHubDesktop\app-3.6.5\resources\app\git\cmd\git.exe"
$env:GIT_TERMINAL_PROMPT = "0"
$cred = "protocol=https`nhost=github.com`n`n" | & $git credential fill 2>&1
$token = ($cred | Select-String '^password=').ToString() -replace '^password=',''
if (-not $token) { throw "没有 GitHub 凭证" }

$headers = @{
  Authorization = "Bearer $token"
  "User-Agent"  = "yanyuan-push"
  Accept        = "application/vnd.github+json"
}
$api = "https://api.github.com"

$root = (Resolve-Path $Dir).Path
$files = Get-ChildItem $root -Recurse -File | Where-Object {
  $_.FullName -notmatch '\\\.git\\' -and $_.FullName -notmatch '\\node_modules\\'
}
Write-Output "准备推送 $($files.Count) 个文件 → $Repo`:$Branch"

$parent = $null
$baseTree = $null
try {
  $ref = Invoke-RestMethod -Uri "$api/repos/$Repo/git/ref/heads/$Branch" -Headers $headers -TimeoutSec 30
  $parent = $ref.object.sha
  $commitInfo = Invoke-RestMethod -Uri "$api/repos/$Repo/git/commits/$parent" -Headers $headers -TimeoutSec 30
  $baseTree = $commitInfo.tree.sha
  Write-Output "  当前 HEAD: $($parent.Substring(0,8))  base_tree: $($baseTree.Substring(0,8))"
} catch {
  # 空仓库无法直接建 blob，先用 contents API 建一个初始提交
  Write-Output "  空仓库：先创建初始提交"
  $readme = "# $Repo`n`n初始提交，稍后由脚本覆盖完整内容。`n"
  $initBody = @{
    message = "init"
    content = [Convert]::ToBase64String([System.Text.Encoding]::UTF8.GetBytes($readme))
    branch  = $Branch
  } | ConvertTo-Json -Compress
  $init = Invoke-RestMethod -Uri "$api/repos/$Repo/contents/README.md" -Method Put -Headers $headers -Body $initBody -ContentType "application/json" -TimeoutSec 60
  $parent = $init.commit.sha
  Write-Output "  初始提交: $($parent.Substring(0,8))"
}

$entries = New-Object System.Collections.ArrayList
$i = 0
foreach ($f in $files) {
  $rel = $f.FullName.Substring($root.Length + 1).Replace('\', '/')
  if ($Prefix) { $rel = "$Prefix/$rel" }
  $b64 = [Convert]::ToBase64String([System.IO.File]::ReadAllBytes($f.FullName))
  $body = @{ content = $b64; encoding = "base64" } | ConvertTo-Json -Compress
  $blob = Invoke-RestMethod -Uri "$api/repos/$Repo/git/blobs" -Method Post -Headers $headers -Body $body -ContentType "application/json" -TimeoutSec 60
  [void]$entries.Add(@{ path = $rel; mode = "100644"; type = "blob"; sha = $blob.sha })
  $i++
  if ($i % 10 -eq 0) { Write-Output "  已上传 $i/$($files.Count)" }
}

$treeBody = @{ tree = $entries }
if ($baseTree) { $treeBody["base_tree"] = $baseTree }
$treeBodyJson = $treeBody | ConvertTo-Json -Depth 6 -Compress
$tree = Invoke-RestMethod -Uri "$api/repos/$Repo/git/trees" -Method Post -Headers $headers -Body $treeBodyJson -ContentType "application/json" -TimeoutSec 60
Write-Output "  tree: $($tree.sha.Substring(0,8))"

$commitBody = @{
  message = $Message
  tree    = $tree.sha
  parents = @(if ($parent) { $parent } else { })
} | ConvertTo-Json -Depth 4 -Compress
$commit = Invoke-RestMethod -Uri "$api/repos/$Repo/git/commits" -Method Post -Headers $headers -Body $commitBody -ContentType "application/json" -TimeoutSec 60
Write-Output "  commit: $($commit.sha.Substring(0,8))"

if ($parent) {
  $refBody = @{ sha = $commit.sha; force = $false } | ConvertTo-Json -Compress
  Invoke-RestMethod -Uri "$api/repos/$Repo/git/refs/heads/$Branch" -Method Patch -Headers $headers -Body $refBody -ContentType "application/json" -TimeoutSec 60 | Out-Null
} else {
  $refBody = @{ ref = "refs/heads/$Branch"; sha = $commit.sha } | ConvertTo-Json -Compress
  Invoke-RestMethod -Uri "$api/repos/$Repo/git/refs" -Method Post -Headers $headers -Body $refBody -ContentType "application/json" -TimeoutSec 60 | Out-Null
}
Write-Output "完成：https://github.com/$Repo/tree/$Branch"
