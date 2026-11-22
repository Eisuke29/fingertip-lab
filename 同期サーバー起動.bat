@echo off
setlocal
cd /d "%~dp0"
title 同期サーバー（このウィンドウを閉じると止まります）
if not exist node_modules (
  echo 初回のため、必要なファイルを入れています（数分かかります）...
  call npm install
)
start "" cmd /c "timeout /t 2 /nobreak >nul & start http://localhost:8080/"
node sync-server.mjs
echo.
echo 同期サーバーが止まりました。上にエラーが出ていないか確認してください。
pause
