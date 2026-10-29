$ErrorActionPreference = 'Stop'
# Compile the shipped GUI helper using Windows' built-in .NET compiler.
Add-Type -Path $env:STUDIO_PICKER_SOURCE -OutputAssembly $env:STUDIO_PICKER_EXE -OutputType WindowsApplication
