; Education Advisor NSIS upgrade (electron-builder nsis.include).
;
; Field installs still ship the previous uninstaller. On --updated that
; uninstaller runs un.atomicRMDir: it Rename-moves every file under INSTDIR
; into $PLUGINSDIR\old-install, and on a busy-file error it restoreFiles and
; Abort. electron-builder 26.18 then ExecWaits that old uninstaller up to five
; times and finally shows $(appCannotBeClosed) ("无法关闭 / 请手动关闭") even
; when no Education Advisor.exe exists. Rename preserves mtimes, so INSTDIR
; looks unchanged after a failed attempt. A ~30k-file tree plus real-time AV
; makes each attempt take minutes, before any new file is extracted.
;
; This include does not change the 7z compression level. The payload stays
; on electron-builder's default LZMA pass. Do not turn that payload into an
; uncompressed archive from here. Skipping unchanged files on upgrade is
; future work and is not implemented; the script still renames the old
; directory and extracts the full new tree. See docs/INSTALLER_PACKING.md.
;
; The new Setup therefore must not execute that old uninstaller. Before
; uninstallOldVersion it:
;   1. Closes real Education Advisor.exe processes only (any install path,
;      including a dev win-unpacked copy). The installer/uninstaller image
;      names are different, so this cannot kill the setup process or treat
;      the "Education Advisor 安装" window as the app.
;   2. Rename-moves each existing install directory aside in one directory
;      operation (same volume, metadata only — not per file).
;   3. Deletes UninstallString so uninstallOldVersion returns immediately.
; The new package is then extracted into an empty INSTDIR, so fat-tree
; leftovers do not remain. After a successful install the aside trees are
; deleted in the background.
;
; customRemoveFiles covers the day this build's own uninstaller is invoked
; with --updated: same directory rename, never atomicRMDir.

!ifndef EAA_UPGRADE_VARS
!define EAA_UPGRADE_VARS
; Declared only for the installer compile. The uninstaller build is a separate
; makensis run (-WX); an unused Var there fails the package.
!ifndef BUILD_UNINSTALLER
Var /GLOBAL EaaUpgradePrepared
!endif
Var /GLOBAL EaaMoveOk
Var /GLOBAL EaaAside1
Var /GLOBAL EaaAside2
Var /GLOBAL EaaAside3
Var /GLOBAL EaaOrig1
Var /GLOBAL EaaOrig2
Var /GLOBAL EaaOrig3
!endif

!macro customHeader
  !ifndef BUILD_UNINSTALLER
    !insertmacro eaaDefineNormalize eaaNormalizeDir norm
    !insertmacro eaaDefineProbe eaaProbeApp probe
    !insertmacro eaaDefineClose eaaCloseRealApp eaaProbeApp close
    !insertmacro eaaDefineMove eaaMoveDirInR9 eaaCloseRealApp eaaProbeApp move
    !insertmacro eaaDefineRollback eaaRollbackAsides rb
    !insertmacro eaaDefineSpawn eaaSpawnAsideDeletes eaaNormalizeDir spawn
    !insertmacro eaaDefinePrepare eaaPrepareFastUpgrade eaaNormalizeDir eaaMoveDirInR9 eaaRollbackAsides prep
  !else
    !insertmacro eaaDefineNormalize un.eaaNormalizeDir unnorm
    !insertmacro eaaDefineProbe un.eaaProbeApp unprobe
    !insertmacro eaaDefineClose un.eaaCloseRealApp un.eaaProbeApp unclose
    !insertmacro eaaDefineMove un.eaaMoveDirInR9 un.eaaCloseRealApp un.eaaProbeApp unmove
    !insertmacro eaaDefineRollback un.eaaRollbackAsides unrb
    !insertmacro eaaDefineSpawn un.eaaSpawnAsideDeletes un.eaaNormalizeDir unspawn
  !endif
!macroend

; Interactive per-user install runs the fast path from customCheckAppRunning,
; after the user has committed to Install. An elevated per-machine inner
; instance skips CHECK_APP_RUNNING, so the same path runs from customInit
; only in that case — never from the outer onInit, which is before the
; directory page (moving the tree there would destroy a cancelled install).
!macro customInit
  !ifndef BUILD_UNINSTALLER
    ${if} ${UAC_IsInnerInstance}
      Call eaaPrepareFastUpgrade
    ${endIf}
  !endif
!macroend

!macro customCheckAppRunning
  !ifndef BUILD_UNINSTALLER
    Call eaaPrepareFastUpgrade
  !else
    Call un.eaaCloseRealApp
    StrCmp $EaaMoveOk "cancel" 0 eaa_un_check_ok
      SetErrorLevel 2
      Quit
    eaa_un_check_ok:
  !endif
!macroend

!macro customInstall
  Call eaaSpawnAsideDeletes
!macroend

!macro customRemoveFiles
  ; Leave INSTDIR so our own cwd cannot pin the directory.
  SetOutPath "$TEMP"
  Call un.eaaCloseRealApp
  StrCmp $EaaMoveOk "cancel" eaa_un_cancel
  StrCpy $R9 "$INSTDIR"
  Call un.eaaNormalizeDir
  Call un.eaaMoveDirInR9
  StrCmp $EaaMoveOk "cancel" eaa_un_cancel
  StrCmp $EaaMoveOk "moved" eaa_un_moved
  ; Not our install directory (or already gone). A real uninstall still
  ; removes whatever is there; an update must not walk the tree file by file.
  ${ifNot} ${isUpdated}
    RMDir /r "$INSTDIR"
  ${endIf}
  Goto eaa_un_done
  eaa_un_moved:
    Call un.eaaSpawnAsideDeletes
    Goto eaa_un_done
  eaa_un_cancel:
    Call un.eaaRollbackAsides
    SetErrorLevel 2
    Abort
  eaa_un_done:
!macroend

; --- $R9 in, normalized path out. Preserves every register except $R9. ---
!macro eaaDefineNormalize _FN _ID
Function ${_FN}
  Push $R8
  StrCpy $R8 $R9 1
  StrCmp $R8 '"' 0 eaa_norm_slash_${_ID}
    StrCpy $R9 $R9 "" 1
    StrCpy $R8 $R9 1 -1
    StrCmp $R8 '"' 0 eaa_norm_slash_${_ID}
      StrCpy $R9 $R9 -1
  eaa_norm_slash_${_ID}:
    StrCmp $R9 "" eaa_norm_done_${_ID}
    StrCpy $R8 $R9 1 -1
    StrCmp $R8 '\' 0 eaa_norm_done_${_ID}
      StrCpy $R9 $R9 -1
      Goto eaa_norm_slash_${_ID}
  eaa_norm_done_${_ID}:
  Pop $R8
FunctionEnd
!macroend

; Sets $R8 to "1" when a process image is exactly Education Advisor.exe.
; tasklist /FI IMAGENAME is an exact image-name match, so it hits a dev
; win-unpacked exe and does not hit "Education Advisor Setup",
; "Uninstall Education Advisor.exe", or the installer window title.
; nsExec::ExecToStack pushes output, then the exit code: first Pop is the code.
!macro eaaDefineProbe _FN _ID
Function ${_FN}
  Push $R0
  Push $R1
  Push $R2
  Push $R3
  Push $R4
  Push $R5
  Push $R6
  Push $R7
  Push $R9
  StrCpy $R8 "0"
  nsExec::ExecToStack '"$SYSDIR\tasklist.exe" /FI "IMAGENAME eq ${APP_EXECUTABLE_FILENAME}" /FO CSV /NH'
  Pop $R0
  Pop $R1
  StrCpy $R2 '"${APP_EXECUTABLE_FILENAME}"'
  StrLen $R3 $R2
  StrLen $R4 $R1
  IntCmp $R3 0 eaa_probe_done_${_ID}
  IntCmp $R4 $R3 0 eaa_probe_done_${_ID} 0
  StrCpy $R5 0
  IntOp $R7 $R4 - $R3
  eaa_probe_scan_${_ID}:
    StrCpy $R6 $R1 $R3 $R5
    StrCmp $R6 $R2 eaa_probe_hit_${_ID}
    IntCmp $R5 $R7 eaa_probe_done_${_ID} 0 eaa_probe_done_${_ID}
    IntOp $R5 $R5 + 1
    Goto eaa_probe_scan_${_ID}
  eaa_probe_hit_${_ID}:
    StrCpy $R8 "1"
  eaa_probe_done_${_ID}:
  Pop $R9
  Pop $R7
  Pop $R6
  Pop $R5
  Pop $R4
  Pop $R3
  Pop $R2
  Pop $R1
  Pop $R0
FunctionEnd
!macroend

; Close real app processes. $EaaMoveOk = "cancel" only if one is still
; running and the user cancels. Never shows $(appCannotBeClosed) when the
; probe result is "0".
!macro eaaDefineClose _FN _PROBE _ID
Function ${_FN}
  eaa_close_begin_${_ID}:
    Call ${_PROBE}
    StrCmp $R8 "1" eaa_close_kill_${_ID} eaa_close_clear_${_ID}
  eaa_close_kill_${_ID}:
    DetailPrint "Closing ${PRODUCT_NAME}..."
    nsExec::Exec '"$SYSDIR\taskkill.exe" /IM "${APP_EXECUTABLE_FILENAME}" /T'
    Sleep 400
    nsExec::Exec '"$SYSDIR\taskkill.exe" /F /IM "${APP_EXECUTABLE_FILENAME}" /T'
    Sleep 500
    Call ${_PROBE}
    StrCmp $R8 "1" 0 eaa_close_clear_${_ID}
    BringToFront
    MessageBox MB_RETRYCANCEL|MB_ICONEXCLAMATION|MB_TOPMOST "$(appCannotBeClosed)" /SD IDCANCEL IDRETRY eaa_close_begin_${_ID}
    SetErrorLevel 2
    StrCpy $EaaMoveOk "cancel"
    Goto eaa_close_done_${_ID}
  eaa_close_clear_${_ID}:
    StrCmp $EaaMoveOk "cancel" eaa_close_done_${_ID}
    StrCpy $EaaMoveOk ""
  eaa_close_done_${_ID}:
FunctionEnd
!macroend

; $R9 is a normalized directory. One Rename of the whole directory, with a
; short retry for a transient AV lock. Records aside/original for rollback
; and for the post-install background delete.
!macro eaaDefineMove _FN _CLOSE _PROBE _ID
Function ${_FN}
  Push $R0
  Push $R5
  Push $R6
  Push $R7
  StrCpy $EaaMoveOk "absent"
  StrLen $R0 $R9
  IntCmp $R0 3 eaa_move_pop_${_ID} eaa_move_pop_${_ID}
  IfFileExists "$R9\${APP_EXECUTABLE_FILENAME}" eaa_move_ours_${_ID} 0
  IfFileExists "$R9\${UNINSTALL_FILENAME}" eaa_move_ours_${_ID} eaa_move_pop_${_ID}
  eaa_move_ours_${_ID}:
    Call ${_CLOSE}
    StrCmp $EaaMoveOk "cancel" eaa_move_pop_${_ID}
    ; onInit did SetOutPath $INSTDIR, which pins this process's cwd inside
    ; the directory and makes the rename fail. Step out first.
    SetOutPath "$TEMP"
    System::Call 'kernel32::GetTickCount() i .r5'
    System::Call 'kernel32::GetCurrentProcessId() i .r6'
    StrCpy $R0 0
    StrCpy $R7 "$R9.__eaa_old_$R5_$R6_0"
  eaa_move_retry_${_ID}:
    IfFileExists "$R7\*.*" 0 eaa_move_do_${_ID}
      IntOp $R0 $R0 + 1
      StrCpy $R7 "$R9.__eaa_old_$R5_$R6_$R0"
      IntCmp $R0 30 eaa_move_locked_${_ID} 0 eaa_move_locked_${_ID}
      Goto eaa_move_retry_${_ID}
  eaa_move_do_${_ID}:
    ClearErrors
    Rename "$R9" "$R7"
    IfErrors 0 eaa_move_ok_${_ID}
    IntOp $R0 $R0 + 1
    IntCmp $R0 40 eaa_move_locked_${_ID} 0 eaa_move_locked_${_ID}
    Sleep 250
    Goto eaa_move_retry_${_ID}
  eaa_move_locked_${_ID}:
    Call ${_PROBE}
    StrCmp $R8 "1" 0 eaa_move_other_${_ID}
      Call ${_CLOSE}
      StrCmp $EaaMoveOk "cancel" eaa_move_pop_${_ID}
      StrCpy $R0 0
      Goto eaa_move_retry_${_ID}
  eaa_move_other_${_ID}:
    BringToFront
    MessageBox MB_RETRYCANCEL|MB_ICONEXCLAMATION|MB_TOPMOST "A file in the existing installation folder is open in another program, so setup cannot replace the folder. Education Advisor is not running.$\r$\n$R9$\r$\n$\r$\nClose that program and click Retry." /SD IDCANCEL IDRETRY eaa_move_other_retry_${_ID}
    StrCpy $EaaMoveOk "cancel"
    Goto eaa_move_pop_${_ID}
  eaa_move_other_retry_${_ID}:
    StrCpy $R0 0
    Goto eaa_move_retry_${_ID}
  eaa_move_ok_${_ID}:
    StrCmp $EaaAside1 "" 0 eaa_move_slot2_${_ID}
      StrCpy $EaaAside1 "$R7"
      StrCpy $EaaOrig1 "$R9"
      Goto eaa_move_noted_${_ID}
    eaa_move_slot2_${_ID}:
    StrCmp $EaaAside2 "" 0 eaa_move_slot3_${_ID}
      StrCpy $EaaAside2 "$R7"
      StrCpy $EaaOrig2 "$R9"
      Goto eaa_move_noted_${_ID}
    eaa_move_slot3_${_ID}:
      StrCpy $EaaAside3 "$R7"
      StrCpy $EaaOrig3 "$R9"
    eaa_move_noted_${_ID}:
    DetailPrint "Moved existing installation aside in one rename: $R7"
    StrCpy $EaaMoveOk "moved"
  eaa_move_pop_${_ID}:
  Pop $R7
  Pop $R6
  Pop $R5
  Pop $R0
FunctionEnd
!macroend

!macro eaaDefineRollback _FN _ID
Function ${_FN}
  StrCmp $EaaAside1 "" eaa_rb2_${_ID}
    ClearErrors
    Rename "$EaaAside1" "$EaaOrig1"
    StrCpy $EaaAside1 ""
    StrCpy $EaaOrig1 ""
  eaa_rb2_${_ID}:
  StrCmp $EaaAside2 "" eaa_rb3_${_ID}
    ClearErrors
    Rename "$EaaAside2" "$EaaOrig2"
    StrCpy $EaaAside2 ""
    StrCpy $EaaOrig2 ""
  eaa_rb3_${_ID}:
  StrCmp $EaaAside3 "" eaa_rb_done_${_ID}
    ClearErrors
    Rename "$EaaAside3" "$EaaOrig3"
    StrCpy $EaaAside3 ""
    StrCpy $EaaOrig3 ""
  eaa_rb_done_${_ID}:
FunctionEnd
!macroend

; Background-delete aside trees only. Refuses any path whose leaf does not
; contain __eaa_old_, so the new INSTDIR cannot be removed. Exec (not
; ExecWait / nsExec) so a tens-of-thousands-file delete does not block extract.
!macro eaaDefineSpawn _FN _NORM _ID
Function ${_FN}
  Push $R0
  Push $R1
  Push $R6
  Push $R7
  Push $R8
  Push $R9
  StrCpy $R0 0
  System::Call 'kernel32::GetTickCount() i .r6'
  StrCpy $R9 "$TEMP\eaa-aside-$R6.txt"
  ClearErrors
  FileOpen $R8 "$R9" w
  IfErrors eaa_spawn_pop_${_ID}
  StrCmp $EaaAside1 "" eaa_sp_a2_${_ID}
    FileWrite $R8 "$EaaAside1$\r$\n"
    IntOp $R0 $R0 + 1
  eaa_sp_a2_${_ID}:
  StrCmp $EaaAside2 "" eaa_sp_a3_${_ID}
    FileWrite $R8 "$EaaAside2$\r$\n"
    IntOp $R0 $R0 + 1
  eaa_sp_a3_${_ID}:
  StrCmp $EaaAside3 "" eaa_sp_scan_${_ID}
    FileWrite $R8 "$EaaAside3$\r$\n"
    IntOp $R0 $R0 + 1
  eaa_sp_scan_${_ID}:
    ; Orphans from an earlier attempt that died before background delete.
    StrCpy $R7 "$INSTDIR"
    Push $R9
    StrCpy $R9 "$R7"
    Call ${_NORM}
    StrCpy $R7 "$R9"
    Pop $R9
    Push $R9
    StrCpy $R9 "$R7"
    !insertmacro eaaAppendOldSiblings $R8 $R0
    Pop $R9
  FileClose $R8
  IntCmp $R0 0 eaa_spawn_empty_${_ID}
  StrCpy $R7 "$TEMP\eaa-rm-$R6.ps1"
  ClearErrors
  FileOpen $R8 "$R7" w
  IfErrors eaa_spawn_empty_${_ID}
  ; $$ is a literal dollar. The script only deletes leaves containing __eaa_old_.
  FileWrite $R8 "$$ErrorActionPreference = 'SilentlyContinue'$\r$\n"
  FileWrite $R8 "if ([string]::IsNullOrWhiteSpace($$args[0])) { exit 0 }$\r$\n"
  FileWrite $R8 "$$list = $$args[0]$\r$\n"
  FileWrite $R8 "if (-not (Test-Path -LiteralPath $$list)) { exit 0 }$\r$\n"
  FileWrite $R8 "foreach ($$raw in @(Get-Content -LiteralPath $$list -Encoding Unicode)) {$\r$\n"
  FileWrite $R8 "  if ($$null -eq $$raw) { continue }$\r$\n"
  FileWrite $R8 "  $$p = ([string]$$raw).Trim().TrimStart([char]0xFEFF)$\r$\n"
  FileWrite $R8 "  if ([string]::IsNullOrWhiteSpace($$p)) { continue }$\r$\n"
  FileWrite $R8 "  $$leaf = Split-Path -Leaf $$p$\r$\n"
  FileWrite $R8 "  if ($$leaf -notlike '*__eaa_old_*') { continue }$\r$\n"
  FileWrite $R8 "  if (-not $$p.StartsWith([string]::Concat([char]92,[char]92,[char]63,[char]92))) { $$p = [string]::Concat([char]92,[char]92,[char]63,[char]92,$$p) }$\r$\n"
  FileWrite $R8 "  Remove-Item -LiteralPath $$p -Recurse -Force -ErrorAction SilentlyContinue$\r$\n"
  FileWrite $R8 "}$\r$\n"
  FileWrite $R8 "Remove-Item -LiteralPath $$list -Force -ErrorAction SilentlyContinue$\r$\n"
  FileClose $R8
  StrCpy $R6 "$WINDIR\Sysnative\WindowsPowerShell\v1.0\powershell.exe"
  IfFileExists "$R6" eaa_spawn_exec_${_ID} 0
  StrCpy $R6 "$WINDIR\System32\WindowsPowerShell\v1.0\powershell.exe"
  IfFileExists "$R6" eaa_spawn_exec_${_ID} eaa_spawn_cmd_${_ID}
  eaa_spawn_exec_${_ID}:
    DetailPrint "Deleting the previous installation in the background."
    Exec '"$R6" -NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File "$R7" "$R9"'
    Goto eaa_spawn_pop_${_ID}
  eaa_spawn_cmd_${_ID}:
    StrCmp $EaaAside1 "" eaa_spawn_pop_${_ID}
    Exec '"$SYSDIR\cmd.exe" /c rmdir /s /q "$EaaAside1"'
    Goto eaa_spawn_pop_${_ID}
  eaa_spawn_empty_${_ID}:
    Delete "$R9"
  eaa_spawn_pop_${_ID}:
  ClearErrors
  Pop $R9
  Pop $R8
  Pop $R7
  Pop $R6
  Pop $R1
  Pop $R0
FunctionEnd
!macroend

; $R9 = install directory whose parent may contain Name.__eaa_old_* orphans.
; $R8 = open file handle. $R0 = count, incremented. Both are preserved aside
; from the count. FindFirst handle uses $R1.
!macro eaaAppendOldSiblings _FILE _COUNT
  Push $R1
  Push $R3
  Push $R4
  Push $R5
  Push $R6
  Push $R7
  StrLen $R3 $R9
  IntCmp $R3 3 eaa_orph_done  eaa_orph_done
  StrCpy $R4 $R3
  eaa_orph_bs:
    IntOp $R4 $R4 - 1
    IntCmp $R4 0 eaa_orph_done eaa_orph_done
    StrCpy $R5 $R9 1 $R4
    StrCmp $R5 '\' eaa_orph_split
    Goto eaa_orph_bs
  eaa_orph_split:
    StrCpy $R6 $R9 $R4
    IntOp $R4 $R4 + 1
    StrCpy $R7 $R9 "" $R4
    StrCmp $R6 "" eaa_orph_done
    StrCmp $R7 "" eaa_orph_done
    ClearErrors
    FindFirst $R1 $R3 "$R6\$R7.__eaa_old_*"
    IfErrors eaa_orph_done
  eaa_orph_loop:
    StrCmp $R3 "" eaa_orph_close
    StrCmp $R3 "." eaa_orph_next
    StrCmp $R3 ".." eaa_orph_next
    FileWrite ${_FILE} "$R6\$R3$\r$\n"
    IntOp ${_COUNT} ${_COUNT} + 1
  eaa_orph_next:
    FindNext $R1 $R3
    Goto eaa_orph_loop
  eaa_orph_close:
    FindClose $R1
  eaa_orph_done:
  Pop $R7
  Pop $R6
  Pop $R5
  Pop $R4
  Pop $R3
  Pop $R1
!macroend

!macro eaaDefinePrepare _FN _NORM _MOVE _ROLLBACK _ID
Function ${_FN}
  StrCmp $EaaUpgradePrepared "1" eaa_prep_done_${_ID}
  StrCpy $EaaUpgradePrepared "1"
  StrCpy $EaaAside1 ""
  StrCpy $EaaAside2 ""
  StrCpy $EaaAside3 ""
  StrCpy $EaaOrig1 ""
  StrCpy $EaaOrig2 ""
  StrCpy $EaaOrig3 ""
  StrCpy $EaaMoveOk ""
  ReadRegStr $R9 HKCU "${INSTALL_REGISTRY_KEY}" "InstallLocation"
  Call ${_NORM}
  Call ${_MOVE}
  StrCmp $EaaMoveOk "cancel" eaa_prep_cancel_${_ID}
  ReadRegStr $R9 HKLM "${INSTALL_REGISTRY_KEY}" "InstallLocation"
  Call ${_NORM}
  Call ${_MOVE}
  StrCmp $EaaMoveOk "cancel" eaa_prep_cancel_${_ID}
  StrCpy $R9 "$INSTDIR"
  Call ${_NORM}
  Call ${_MOVE}
  StrCmp $EaaMoveOk "cancel" eaa_prep_cancel_${_ID}
  ; uninstallOldVersion returns immediately when UninstallString is empty,
  ; so the previous uninstaller (and its per-file --updated rename) never runs.
  DeleteRegValue HKCU "${UNINSTALL_REGISTRY_KEY}" "UninstallString"
  DeleteRegValue HKLM "${UNINSTALL_REGISTRY_KEY}" "UninstallString"
  DeleteRegValue SHELL_CONTEXT "${UNINSTALL_REGISTRY_KEY}" "UninstallString"
  !ifdef UNINSTALL_REGISTRY_KEY_2
    DeleteRegValue HKCU "${UNINSTALL_REGISTRY_KEY_2}" "UninstallString"
    DeleteRegValue HKLM "${UNINSTALL_REGISTRY_KEY_2}" "UninstallString"
    DeleteRegValue SHELL_CONTEXT "${UNINSTALL_REGISTRY_KEY_2}" "UninstallString"
  !endif
  ClearErrors
  DetailPrint "Skipped the previous uninstaller; new files extract into an empty folder."
  Goto eaa_prep_done_${_ID}
  eaa_prep_cancel_${_ID}:
    Call ${_ROLLBACK}
    SetErrorLevel 2
    Quit
  eaa_prep_done_${_ID}:
FunctionEnd
!macroend
