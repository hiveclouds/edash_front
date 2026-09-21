// ============================================================
// 360eDash — Login (js/login.js)
// ------------------------------------------------------------
// Real auth call ke backend Hono (bukan lagi mock TEST_ACCOUNTS).
// Role TIDAK PERNAH dipilih manual di form -- role itu sudah
// melekat ke akun di database, backend yang menentukan lewat
// JOIN ke tabel roles. Form cuma butuh username + password.
// ============================================================

document.addEventListener("DOMContentLoaded", () => {

    // Back link: kembali ke tab/halaman sebelumnya (browser history),
    // bukan hardcode ke solar-calculator.html. Kalau nggak ada history
    // sebelumnya (misal login dibuka langsung dari URL baru / tab baru),
    // fallback ke halaman index.
    const backLink = document.getElementById("loginBackLink");
    if (backLink) {
        backLink.addEventListener("click", (e) => {
            e.preventDefault();
            if (window.history.length > 1) {
                window.history.back();
            } else {
                window.location.href = "index.html";
            }
        });
    }

    const form = document.getElementById("loginForm");
    if (!form) return;

    const usernameInput = document.getElementById("loginUsername");
    const passwordInput = document.getElementById("loginPassword");
    const submitBtn = document.getElementById("loginSubmit");

    const togglePasswordBtn = document.getElementById("togglePassword");
    if (togglePasswordBtn) {
        togglePasswordBtn.addEventListener("click", () => {
            const isPassword = passwordInput.type === "password";
            passwordInput.type = isPassword ? "text" : "password";
            const icon = togglePasswordBtn.querySelector("i");
            if (icon) icon.className = isPassword ? "fa-regular fa-eye-slash" : "fa-regular fa-eye";
        });
    }

    form.addEventListener("submit", async (e) => {

        e.preventDefault();
        clearErrors(form);

        const username = usernameInput.value.trim();
        const password = passwordInput.value;

        let hasError = false;

        if (!username) {
            showFieldError(usernameInput, "usernameError", "Username is required");
            hasError = true;
        }
        if (!password) {
            showFieldError(passwordInput, "passwordError", "Password is required");
            hasError = true;
        }
        if (hasError) return;

        setLoading(submitBtn, true);

        try {
            const user = await authenticate({ username, password });

            // sessionStorage.edash-role dipakai di banyak halaman lain
            // (project-selector.js, setting.js, admin-view.js, dll) untuk
            // cek akses -- diisi dari roleKey resmi (mis. "root",
            // "operator", "staff"), BUKAN lagi enum lama "admin360".
            sessionStorage.setItem("edash-user", user.username);
            sessionStorage.setItem("edash-role", user.roleKey);
            sessionStorage.setItem("edash-role-label", user.roleLabel);
            sessionStorage.setItem("edash-role-tier", user.roleTier);
            sessionStorage.setItem("edash-can-manage-settings", user.canManageSettings ? "1" : "0");
            sessionStorage.setItem("edash-user-id", user.id);
            sessionStorage.setItem("edash-login-time", Date.now().toString());
            // Nama tampilan (Settings > Profil > Full Name) & foto profil --
            // dipakai header/sidebar (lihat populateHeaderProfile() di
            // main.js) supaya sapaan & avatar konsisten dengan apa yang
            // diisi user di Settings, BUKAN cuma username login. Fallback
            // ke username/kosong kalau user belum pernah isi Full Name /
            // upload foto sama sekali.
            sessionStorage.setItem("edash-user-fullname", user.fullName || user.username);
            sessionStorage.setItem("edash-user-photo", user.photoUrl || "");
            sessionStorage.setItem("edash-user-email", user.email || "");
            // Daftar permission_key yang ALLOWED buat role ini (Settings >
            // Role Access) -- dipakai hasPermission() di main.js buat gate
            // halaman/tombol. Kosong buat root (root selalu lolos, dicek
            // lewat edash-role-tier === "root", BUKAN lewat array ini).
            sessionStorage.setItem("edash-permissions", JSON.stringify(user.permissions || []));

            if (typeof logActivity === "function") {
                await logActivity({
                    eventType: "login",
                    user: user.username,
                    userRole: user.roleKey,
                    status: "success",
                    detail: "Successfully logged in to 360eDash dashboard",
                });
            }

            // Ticket deep-link (lihat auth guard di index.html & tombol
            // "Copy Link" di ticketing.js): kalau user datang dari link
            // ticket yang di-share tapi belum login, index.html sudah
            // menyimpan tujuan aslinya di sini SEBELUM melempar ke halaman
            // marketing. Konsumsi (baca + hapus) sekali saja supaya login
            // normal berikutnya tetap ke index.html biasa.
            const pendingDeepLink = sessionStorage.getItem("edash-pending-deeplink");
            sessionStorage.removeItem("edash-pending-deeplink");
            window.location.href = pendingDeepLink ? `../${pendingDeepLink}` : "../index.html";

        } catch (err) {

            if (typeof logActivity === "function") {
                logActivity({
                    eventType: "login",
                    user: username || "Anonymous",
                    userRole: null,
                    status: "failed",
                    detail: `Failed login attempt — ${err.message || "invalid username or password"}`,
                });
            }

            showGeneralError(form, err.message || "Invalid username or password");

        } finally {
            setLoading(submitBtn, false);
        }

    });

});

// =============================
// Real Auth Call — POST {EDASH_BACKEND_API_BASE}/auth/login
// =============================
async function authenticate({ username, password }) {

    const apiBase = window.EDASH_BACKEND_API_BASE;
    if (!apiBase) {
        throw new Error("EDASH_BACKEND_API_BASE belum di-set -- cek js/api-config.js dimuat sebelum login.js");
    }

    let response;
    try {
        response = await fetch(`${apiBase}/auth/login`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            credentials: "include", // WAJIB -- supaya cookie session_token (HttpOnly) dari backend tersimpan browser
            body: JSON.stringify({ username, password }),
        });
    } catch (networkErr) {
        throw new Error("Tidak bisa menghubungi server. Cek koneksi internet Anda.");
    }

    let payload;
    try {
        payload = await response.json();
    } catch {
        throw new Error("Respons server tidak valid.");
    }

    if (!response.ok || !payload.success) {
        const code = payload?.error?.code;
        if (code === "INVALID_CREDENTIALS") throw new Error("Username atau password salah.");
        if (code === "ROLE_NOT_ASSIGNED") throw new Error("Akun ini belum memiliki role yang valid. Hubungi 360master.");
        throw new Error(payload?.error?.message || "Login gagal.");
    }

    return payload.data.user; // { id, username, email, roleKey, roleLabel, roleTier, canManageSettings, ... }
}

// =============================
// Error / Loading Helpers
// =============================
function showFieldError(inputEl, errorId, message) {
    const group = inputEl.closest(".form-group");
    const errorEl = document.getElementById(errorId);
    if (group) group.classList.add("has-error");
    if (errorEl) {
        errorEl.textContent = message;
        errorEl.classList.add("is-visible");
    }
}

function showGeneralError(form, message) {
    const errorEl = form.querySelector("#loginError");
    if (!errorEl) return;
    errorEl.textContent = message;
    errorEl.classList.add("is-visible");
}

function clearErrors(form) {
    form.querySelectorAll(".form-group.has-error").forEach((group) => group.classList.remove("has-error"));
    form.querySelectorAll(".form-error").forEach((el) => {
        el.textContent = "";
        el.classList.remove("is-visible");
    });
}

function setLoading(button, isLoading) {
    if (!button) return;
    const label = button.querySelector(".btn-login__label");
    button.disabled = isLoading;
    if (label) label.textContent = isLoading ? "Signing in..." : "Login";
}

/* Apply the persisted dashboard theme on the standalone login page. */
(function applyLoginTheme() {
    const theme = localStorage.getItem('edash-theme') === 'dark' ? 'dark' : 'light';
    document.documentElement.setAttribute('data-theme', theme);
    document.documentElement.style.colorScheme = theme;
})();
