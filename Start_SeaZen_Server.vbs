Set objShell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
strDir = fso.GetParentFolderName(WScript.ScriptFullName)
objShell.CurrentDirectory = strDir
objShell.Run "pythonw.exe """ & strDir & "\launcher.py""", 0, False
