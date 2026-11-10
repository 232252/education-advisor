/* Installed over the previous NSIS uninstaller during an upgrade.
   ExitProcess(0) so electron-builder treats uninstall as successful and
   does not delete the install directory. No console window.

   Rebuild (committed bytes must stay stable):
     SOURCE_DATE_EPOCH=1700000000 x86_64-w64-mingw32-gcc -nostdlib -fno-ident \
       -Wl,-e,start -Wl,-subsystem,windows -Wl,--no-insert-timestamp -Os -s \
       -o resources/eaa-keep.exe resources/eaa-keep.c -lkernel32
*/
__declspec(dllimport) void __stdcall ExitProcess(unsigned int code);
void start(void) { ExitProcess(0); }
