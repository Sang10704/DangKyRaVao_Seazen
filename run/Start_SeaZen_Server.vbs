Set objShell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
runDir = fso.GetParentFolderName(WScript.ScriptFullName)
rootDir = fso.GetParentFolderName(runDir)
objShell.CurrentDirectory = rootDir
objShell.Run "pythonw.exe """ & rootDir & "\launcher.py""", 0, False
