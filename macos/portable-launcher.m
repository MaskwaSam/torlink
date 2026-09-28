#import <AppKit/AppKit.h>

static void ShowFailure(NSString *detail) {
    [NSApplication sharedApplication];
    [NSApp setActivationPolicy:NSApplicationActivationPolicyAccessory];
    [NSApp activateIgnoringOtherApps:YES];

    NSAlert *alert = [[NSAlert alloc] init];
    alert.messageText = @"TorLink could not start";
    alert.informativeText = detail;
    alert.alertStyle = NSAlertStyleCritical;
    [alert runModal];
}

int main(void) {
    @autoreleasepool {
        NSString *resources = NSBundle.mainBundle.resourcePath;
        NSString *command = [resources stringByAppendingPathComponent:@"Open TorLink.command"];

        if (![NSFileManager.defaultManager isExecutableFileAtPath:command]) {
            ShowFailure(@"The portable launcher inside TorLink.app is missing or is not executable.");
            return 1;
        }

        NSTask *task = [[NSTask alloc] init];
        task.executableURL = [NSURL fileURLWithPath:@"/usr/bin/open"];
        task.arguments = @[@"-b", @"com.apple.Terminal", command];

        NSError *error = nil;
        if (![task launchAndReturnError:&error]) {
            ShowFailure(error.localizedDescription ?: @"Terminal could not be opened.");
            return 1;
        }
    }
    return 0;
}
