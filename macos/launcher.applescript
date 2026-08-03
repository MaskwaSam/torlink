use framework "Foundation"
use framework "AppKit"

on showFailure(titleText, detailText)
	set alertPanel to current application's NSAlert's alloc()'s init()
	alertPanel's setMessageText:titleText
	alertPanel's setInformativeText:detailText
	alertPanel's setAlertStyle:(current application's NSAlertStyleCritical)
	alertPanel's runModal()
end showFailure

on run
	set appRoot to ((current application's NSBundle's mainBundle()'s bundlePath()) as text) & "/"
	set projectRootMarker to appRoot & "Contents/Resources/project-root"
	set markerString to current application's NSString's stringWithContentsOfFile:projectRootMarker encoding:(current application's NSUTF8StringEncoding) |error|:(missing value)

	if markerString is missing value then
		my showFailure("TorLink could not start", "The app's checkout marker is missing. Rebuild TorLink.app from the current checkout.")
		return
	end if

	set projectRoot to (markerString's stringByTrimmingCharactersInSet:(current application's NSCharacterSet's whitespaceAndNewlineCharacterSet())) as text
	set commandPath to projectRoot & "/Open TorLink.command"
	set fileManager to current application's NSFileManager's defaultManager()

	if not ((fileManager's isExecutableFileAtPath:commandPath) as boolean) then
		my showFailure("TorLink could not start", "The TorLink checkout or its launcher is missing. Rebuild TorLink.app from the current checkout.")
		return
	end if

	try
		current application's NSTask's launchedTaskWithLaunchPath:"/usr/bin/open" arguments:{"-b", "com.apple.Terminal", commandPath}
	on error errorMessage
		my showFailure("TorLink could not open Terminal", errorMessage)
	end try
end run
