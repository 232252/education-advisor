; Setup.exe include. electron-builder picks this up from buildResources
; (resources/installer.nsh). It is not used by the portable target.
;
; An upgrade used to run the previous uninstaller, which deletes $INSTDIR,
; then CopyFiles the new tree. Every installed file was rewritten.
; This file:
;   1. Swaps the previous uninstaller for resources/eaa-keep.exe (exits 0)
;      so the install directory stays on disk. The real uninstaller is
;      restored if the user cancels, and rewritten by registryAddInstallInfo
;      when the install succeeds.
;   2. Defines eaaTryIncrementalCopy. scripts/after-pack-trim.mjs patches
;      app-builder-lib's extractUsing7za to call it. The script compares
;      size and SHA-256 and does not write files that already match.
; A first install has no app exe, so the stock CopyFiles path still runs.

!include LogicLib.nsh
!include getProcessInfo.nsh

; Captured at include time. ${__FILEDIR__} inside a macro is the main
; script's directory, not this file's, so the File paths would miss.
!ifndef EAA_NSIS_DIR
  !define EAA_NSIS_DIR "${__FILEDIR__}"
!endif

Var pid
Var EaaUninstallerBackup

!macro customCheckAppRunning
  !insertmacro IS_POWERSHELL_AVAILABLE
  !insertmacro _CHECK_APP_RUNNING

  ; The uninstaller process is this same script. Never swap the exe that
  ; is running. old-uninstaller.exe is electron-builder's copy; the other
  ; name is an Add/Remove Programs launch.
  ${GetProcessInfo} 0 $0 $1 $2 $3 $4
  StrCmp $3 "" eaa_after_neutralize
  StrCmp $3 "old-uninstaller.exe" eaa_after_neutralize
  StrCmp $3 "${UNINSTALL_FILENAME}" eaa_after_neutralize

  IfFileExists "$INSTDIR\${APP_EXECUTABLE_FILENAME}" 0 eaa_after_neutralize
  IfFileExists "$INSTDIR\${UNINSTALL_FILENAME}" 0 eaa_after_neutralize

  System::Call 'kernel32::GetCurrentProcessId()i.r0'
  StrCpy $EaaUninstallerBackup "$TEMP\eaa-uninst-$0.exe"
  ClearErrors
  CopyFiles /SILENT "$INSTDIR\${UNINSTALL_FILENAME}" "$EaaUninstallerBackup"
  IfErrors eaa_neutralize_backup_failed

  SetFileAttributes "$INSTDIR\${UNINSTALL_FILENAME}" NORMAL
  File /oname=$PLUGINSDIR\eaa-keep.exe "${EAA_NSIS_DIR}/eaa-keep.exe"
  ClearErrors
  CopyFiles /SILENT "$PLUGINSDIR\eaa-keep.exe" "$INSTDIR\${UNINSTALL_FILENAME}"
  IfErrors eaa_neutralize_restore
  DetailPrint "Keeping installed files. The previous uninstaller will not delete them."
  Goto eaa_after_neutralize

  eaa_neutralize_backup_failed:
    DetailPrint "Could not back up the previous uninstaller. This upgrade will recopy installed files."
    StrCpy $EaaUninstallerBackup ""
    ClearErrors
    Goto eaa_after_neutralize

  eaa_neutralize_restore:
    DetailPrint "Could not swap the previous uninstaller. Restoring it and recopying installed files."
    SetFileAttributes "$INSTDIR\${UNINSTALL_FILENAME}" NORMAL
    CopyFiles /SILENT "$EaaUninstallerBackup" "$INSTDIR\${UNINSTALL_FILENAME}"
    Delete "$EaaUninstallerBackup"
    StrCpy $EaaUninstallerBackup ""
    ClearErrors

  eaa_after_neutralize:
!macroend

; Runs when THIS version's uninstaller is launched. --updated is how the
; next Setup.exe invokes it. A real uninstall does not pass --updated.
!macro customRemoveFiles
  ${If} ${isUpdated}
    DetailPrint "Keeping already installed files for the incremental upgrade."
  ${Else}
    SetOutPath $TEMP
    RMDir /r $INSTDIR
  ${EndIf}
!macroend

!macro eaaTryIncrementalCopy
  IfFileExists "$OUTDIR\${APP_EXECUTABLE_FILENAME}" 0 eaa_inc_done
  IfFileExists "$PLUGINSDIR\7z-out\${APP_EXECUTABLE_FILENAME}" 0 eaa_inc_done
  File /oname=$PLUGINSDIR\eaa-copy-changed.ps1 "${EAA_NSIS_DIR}/eaa-copy-changed.ps1"
  System::Call 'kernel32::SetEnvironmentVariable(t "EAA_UPGRADE_SOURCE", t "$PLUGINSDIR\7z-out")'
  System::Call 'kernel32::SetEnvironmentVariable(t "EAA_UPGRADE_DEST", t "$OUTDIR")'
  System::Call 'kernel32::SetEnvironmentVariable(t "EAA_UPGRADE_KEEP", t "uninstallerIcon.ico|${UNINSTALL_FILENAME}")'
  ClearErrors
  nsExec::ExecToLog `"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$PLUGINSDIR\eaa-copy-changed.ps1"`
  Pop $0
  StrCmp $0 0 0 eaa_inc_fail
  StrCpy $R2 "1"
  DetailPrint "Incremental upgrade: unchanged files already in the install folder were not written again."
  Goto eaa_inc_done
  eaa_inc_fail:
    DetailPrint "Incremental compare failed (exit $0). Copying the full tree."
  eaa_inc_done:
!macroend

!macro customInstall
  StrCmp $EaaUninstallerBackup "" eaa_install_done
  Delete "$EaaUninstallerBackup"
  StrCpy $EaaUninstallerBackup ""
  eaa_install_done:
!macroend

; Expanded at global scope after common.nsh, so UNINSTALL_FILENAME exists.
; Defining the callbacks here (instead of at the top of this file) is what
; makes that define visible.
!macro customHeader
  Function eaaRestoreUninstaller
    StrCmp $EaaUninstallerBackup "" eaa_restore_done
    IfFileExists "$EaaUninstallerBackup" 0 eaa_restore_clear
    SetFileAttributes "$INSTDIR\${UNINSTALL_FILENAME}" NORMAL
    ClearErrors
    CopyFiles /SILENT "$EaaUninstallerBackup" "$INSTDIR\${UNINSTALL_FILENAME}"
    eaa_restore_clear:
      Delete "$EaaUninstallerBackup"
      StrCpy $EaaUninstallerBackup ""
      ClearErrors
    eaa_restore_done:
  FunctionEnd

  Function .onUserAbort
    Call eaaRestoreUninstaller
  FunctionEnd

  Function .onInstFailed
    Call eaaRestoreUninstaller
  FunctionEnd
!macroend
