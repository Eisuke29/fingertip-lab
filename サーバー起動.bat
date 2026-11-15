@echo off
setlocal
cd /d "%~dp0"
title fingertip-lab 起動

rem すでにサーバーが動いていれば、画面を開くだけ
curl -s -m 2 http://localhost:5173/api/health >nul 2>&1
if not errorlevel 1 goto open

if not exist node_modules (
  echo 初回のため、必要なファイルを入れています（数分かかります）...
  call npm install
  if errorlevel 1 goto fail
)

echo サーバーを起動しています...
start "fingertip-lab サーバー（このウィンドウを閉じると止まります）" /min cmd /k "npm run dev"

set /a n=0
:wait
timeout /t 1 /nobreak >nul
curl -s -m 2 http://localhost:5173/api/health >nul 2>&1
if not errorlevel 1 goto open
set /a n+=1
if %n% lss 60 goto wait
goto fail

:open
start "" "http://localhost:5173/tracker"
echo.
echo 指の読み取り画面をブラウザで開きました。
echo iPadは、画面の「③ iPadで表示を開く」のQRコードから開いてください。
echo サーバーを止めるときは、最小化された「fingertip-lab サーバー」のウィンドウを閉じます。
echo.
timeout /t 8 >nul
exit /b 0

:fail
echo.
echo サーバーを起動できませんでした。
echo 最小化された「fingertip-lab サーバー」のウィンドウにエラーが出ていないか確認してください。
pause
exit /b 1
