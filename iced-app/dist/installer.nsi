; Education Advisor — Windows installer (NSIS 3.x)
; Produces a single self-contained .exe installer that drops the app
; into %LOCALAPPDATA%\EducationAdvisor (per-user, no admin needed),
; with Start Menu + Desktop shortcuts and a clean uninstaller.

Unicode true
ManifestDPIAware true

!define APP_NAME "Education Advisor"
!define APP_PUBLISHER "Education Advisor Team"
!define APP_VERSION "1.0.3"
!define APP_EXE "education-advisor-iced.exe"
!define APP_REGKEY "Software\EducationAdvisor"
!define APP_UNINST_KEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\EducationAdvisor"

Name "${APP_NAME} ${APP_VERSION}"
OutFile "EducationAdvisor-Setup-${APP_VERSION}-x64.exe"
InstallDir "$LOCALAPPDATA\EducationAdvisor"
InstallDirRegKey HKCU "${APP_REGKEY}" "InstallDir"
RequestExecutionLevel user
ShowInstDetails show
ShowUnInstDetails show
SetCompressor /SOLID lzma
SetOverwrite on

; Modern UI
!include "MUI2.nsh"
!include "LogicLib.nsh"

!define MUI_ABORTWARNING
!define MUI_FINISHPAGE_RUN "$INSTDIR\${APP_EXE}"
!define MUI_FINISHPAGE_RUN_TEXT "启动 Education Advisor"
!define MUI_FINISHPAGE_SHOWREADME "$INSTDIR\使用说明.txt"
!define MUI_FINISHPAGE_SHOWREADME_TEXT "查看使用说明"
!define MUI_FINISHPAGE_SHOWREADME_CHECKED

!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH

!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES

!insertmacro MUI_LANGUAGE "SimpChinese"
!insertmacro MUI_LANGUAGE "English"

Section "MainSection" SEC01
  SetOutPath "$INSTDIR"
  File "education-advisor-iced.exe"
  File "使用说明.txt"

  ; Agent persona / compliance / skills assets — required for full
  ; agent prompts at runtime (the exe reads them from the CWD).
  SetOutPath "$INSTDIR\agents"
  File /nonfatal "agents\*.md"

  SetOutPath "$INSTDIR\config"
  File /nonfatal "config\*.*"

  SetOutPath "$INSTDIR\skills"
  File /nonfatal "skills\*.md"

  ; Start Menu shortcuts
  CreateDirectory "$SMPROGRAMS\${APP_NAME}"
  CreateShortCut "$SMPROGRAMS\${APP_NAME}\${APP_NAME}.lnk" "$INSTDIR\${APP_EXE}" "" "$INSTDIR\${APP_EXE}" 0
  CreateShortCut "$SMPROGRAMS\${APP_NAME}\卸载 ${APP_NAME}.lnk" "$INSTDIR\uninstall.exe" "" "$INSTDIR\uninstall.exe" 0

  ; Desktop shortcut
  CreateShortCut "$DESKTOP\${APP_NAME}.lnk" "$INSTDIR\${APP_EXE}" "" "$INSTDIR\${APP_EXE}" 0

  ; Uninstaller
  WriteUninstaller "$INSTDIR\uninstall.exe"

  ; Registry entries for Add/Remove Programs
  WriteRegStr HKCU "${APP_REGKEY}" "InstallDir" "$INSTDIR"
  WriteRegStr HKCU "${APP_UNINST_KEY}" "DisplayName" "${APP_NAME}"
  WriteRegStr HKCU "${APP_UNINST_KEY}" "DisplayVersion" "${APP_VERSION}"
  WriteRegStr HKCU "${APP_UNINST_KEY}" "Publisher" "${APP_PUBLISHER}"
  WriteRegStr HKCU "${APP_UNINST_KEY}" "DisplayIcon" "$INSTDIR\${APP_EXE}"
  WriteRegStr HKCU "${APP_UNINST_KEY}" "UninstallString" '"$INSTDIR\uninstall.exe"'
  WriteRegStr HKCU "${APP_UNINST_KEY}" "InstallLocation" "$INSTDIR"
  WriteRegStr HKCU "${APP_UNINST_KEY}" "NoModify" "1"
  WriteRegStr HKCU "${APP_UNINST_KEY}" "NoRepair" "1"

  ; Estimate install size for ARP
  ${If} ${FileExists} "$INSTDIR\${APP_EXE}"
    SectionGetSize ${SEC01} $0
    WriteRegDWORD HKCU "${APP_UNINST_KEY}" "EstimatedSize" $0
  ${EndIf}
SectionEnd

Section "Uninstall"
  ; Kill running instance first (best effort)
  ExecWait '"$INSTDIR\${APP_EXE}" --quit' $0

  Delete "$INSTDIR\${APP_EXE}"
  Delete "$INSTDIR\使用说明.txt"
  Delete "$INSTDIR\uninstall.exe"
  RMDir /r "$INSTDIR\agents"
  RMDir /r "$INSTDIR\config"
  RMDir /r "$INSTDIR\skills"
  RMDir /r "$INSTDIR\data"
  RMDir "$INSTDIR"

  ; Shortcuts
  Delete "$DESKTOP\${APP_NAME}.lnk"
  RMDir /r "$SMPROGRAMS\${APP_NAME}"

  ; Registry
  DeleteRegKey HKCU "${APP_UNINST_KEY}"
  DeleteRegKey HKCU "${APP_REGKEY}"
SectionEnd

Function .onInit
  ; Per-user install — no UAC prompt.
FunctionEnd
