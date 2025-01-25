@echo off
:: Este script detiene el proceso de Node.js que se ejecuta en segundo plano.

:: Busca el proceso node.exe y lo detiene
tasklist /FI "IMAGENAME eq node.exe" | find /I "node.exe" >nul 2>&1
if errorlevel 1 (
    echo No se encontró ningún proceso de Node.js en ejecución.
    exit /b 1
)

:: Termina los procesos de Node.js
taskkill /IM node.exe /F >nul 2>&1
if errorlevel 0 (
    echo El proceso de Node.js fue detenido exitosamente.
) else (
    echo Hubo un problema al intentar detener el proceso.
)

:: Fin del script
