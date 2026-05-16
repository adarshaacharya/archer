@echo off
setlocal
if "%LANG%"=="" if "%LC_ALL%"=="" (
  set LANG=en_US.UTF-8
  set LC_ALL=en_US.UTF-8
)
chcp 65001 >nul 2>&1
where bun >nul 2>&1
if errorlevel 1 (
  echo archer: bun is required (https://bun.sh). Install bun, then retry. 1>&2
  exit /b 1
)
bun "%~dp0..\dist\index.js" %*
