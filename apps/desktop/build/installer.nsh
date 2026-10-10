; Added to the NSIS installer (electron-builder.yml → nsis.include).

; Switchboard registers switchboard:// links for the user when it starts (app.setAsDefaultProtocolClient), so
; uninstalling removes them. An update runs the old version's uninstaller too; the links stay then.
!macro customUnInstall
  ${ifNot} ${isUpdated}
    DeleteRegKey HKCU "Software\Classes\switchboard"
  ${endIf}
!macroend
