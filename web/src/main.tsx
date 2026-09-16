import "@fontsource-variable/inter";
import "@fontsource-variable/jetbrains-mono";
import { bootstrapAppearance } from "@/services/appearance-bootstrap";
import { runLocalRuntimeBootstrap } from "@/services/local-runtime-bootstrap";

runLocalRuntimeBootstrap(
    {
        get href() {
            return window.location.href;
        },
        replaceUrl(url) {
            window.history.replaceState(window.history.state, "", url);
        },
        removeStorageItem(key) {
            window.localStorage.removeItem(key);
        },
    },
    () => {
        // The public film entry checks its availability independently of workspace bootstrap.
        if (/^\/welcome\/?$/.test(window.location.pathname)) void import("./welcome-application");
        else void bootstrapAppearance().finally(() => import("./application"));
    },
);
