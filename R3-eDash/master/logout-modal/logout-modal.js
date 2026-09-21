// ============================================================
// Master Logout Modal Component — 360eDash
// Opens from the sidebar "Logout" item. Handles ESC, backdrop
// click, and a focus trap so keyboard users never tab out of
// the dialog while it's open.
// ============================================================

let lgLastFocusedEl = null;

// =============================
// Entry point (called once from main.js after all components load)
// =============================

function initLogoutModal() {

    const overlay = document.getElementById("lgOverlay");
    const trigger = document.getElementById("sbLogoutBtn");
    const cancelBtn = document.getElementById("lgCancelBtn");
    const confirmBtn = document.getElementById("lgConfirmBtn");

    if (!overlay || !trigger) return;

    // Open modal from the sidebar Logout link
    trigger.addEventListener("click", (e) => {

        e.preventDefault();
        lgOpen();

    });

    // Cancel button closes without logging out
    cancelBtn.addEventListener("click", () => {

        lgClose();

    });

    // Click on the dark backdrop (not the card itself) closes it
    overlay.addEventListener("click", (e) => {

        if (e.target === overlay) {
            lgClose();
        }

    });

    // ESC closes the modal, Tab is trapped inside it
    document.addEventListener("keydown", (e) => {

        if (!overlay.classList.contains("is-open")) return;

        if (e.key === "Escape") {
            lgClose();
        }

        if (e.key === "Tab") {
            lgTrapFocus(e);
        }

    });

    // Confirm button performs the actual logout
    confirmBtn.addEventListener("click", () => {

        lgConfirmLogout(confirmBtn);

    });

}

// =============================
// Open / close
// =============================

function lgOpen() {

    const overlay = document.getElementById("lgOverlay");
    const modal = document.getElementById("lgModal");

    if (!overlay || !modal) return;

    // Remember what had focus so we can restore it on close
    lgLastFocusedEl = document.activeElement;

    overlay.classList.add("is-open");
    overlay.setAttribute("aria-hidden", "false");

    // Move focus into the dialog once the open transition starts
    const firstFocusable = lgGetFocusable(modal)[0];

    if (firstFocusable) {
        firstFocusable.focus();
    }

}

function lgClose() {

    const overlay = document.getElementById("lgOverlay");

    if (!overlay) return;

    overlay.classList.remove("is-open");
    overlay.setAttribute("aria-hidden", "true");

    // Return focus to whatever triggered the modal
    if (lgLastFocusedEl && typeof lgLastFocusedEl.focus === "function") {
        lgLastFocusedEl.focus();
    }

}

// =============================
// Confirm logout
// =============================

function lgConfirmLogout(confirmBtn) {

    const cancelBtn = document.getElementById("lgCancelBtn");

    confirmBtn.disabled = true;
    cancelBtn.disabled = true;
    confirmBtn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> <span>Logging out...</span>`;

    if (typeof logActivity === "function") {
        logActivity({
            eventType: "logout",
            user: sessionStorage.getItem("edash-user") || "Anonymous",
            userRole: sessionStorage.getItem("edash-role") || null,
            status: "success",
            detail: "Logged out of 360eDash dashboard",
        });
    }

    setTimeout(() => {
        window.location.replace("main-page/index.html");
    }, 700);
}

// =============================
// Focus trap helpers
// =============================

function lgGetFocusable(container) {

    const selector = [
        "a[href]",
        "button:not([disabled])",
        "input:not([disabled])",
        "select:not([disabled])",
        "textarea:not([disabled])",
        "[tabindex]:not([tabindex='-1'])"
    ].join(", ");

    return Array.from(container.querySelectorAll(selector))
        .filter((el) => el.offsetParent !== null);

}

function lgTrapFocus(e) {

    const modal = document.getElementById("lgModal");

    if (!modal) return;

    const focusable = lgGetFocusable(modal);

    if (!focusable.length) return;

    const first = focusable[0];
    const last = focusable[focusable.length - 1];

    if (e.shiftKey && document.activeElement === first) {

        e.preventDefault();
        last.focus();

    } else if (!e.shiftKey && document.activeElement === last) {

        e.preventDefault();
        first.focus();

    }

}
