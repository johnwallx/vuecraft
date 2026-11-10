; NSIS installer hooks (bundle.windows.nsis.installerHooks in tauri.conf.json).

; Tauri's APP_UNASSOCIATE restores the previous default for .vuecraft from its backup value but
; leaves that backup value and the .vuecraft key behind. Remove them, keeping the key whenever
; another program still owns the extension (non-empty default) or has subkeys there.
; The value name is "<fileAssociations name>_backup" (name "VUECraft Map" in tauri.conf.json).
!macro NSIS_HOOK_POSTUNINSTALL
  DeleteRegValue SHCTX "Software\Classes\.vuecraft" "VUECraft Map_backup"
  ReadRegStr $R0 SHCTX "Software\Classes\.vuecraft" ""
  StrCmp $R0 "" 0 +3
    ; /ifempty means no subkeys and no values, so drop the empty default value first.
    DeleteRegValue SHCTX "Software\Classes\.vuecraft" ""
    DeleteRegKey /ifempty SHCTX "Software\Classes\.vuecraft"
!macroend
