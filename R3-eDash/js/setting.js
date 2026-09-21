// ============================================================
// Page: Settings — 360eDash
// Appearance (theme), Language, Profile, Account.
// Dipanggil oleh main.js -> loadPage() setiap kali halaman
// "pages/setting.html" selesai dimuat ke #page-root.
// ============================================================

const ST_STORAGE_THEME = "edash-theme";
const ST_ROLE_ACCESS_STORAGE = "edash-role-permissions";
const ST_ROLE_ACCESS_NAMES_STORAGE = "edash-role-names";

// =============================
// Entry point
// =============================

function initSetting() {

    // Must run before stTabSwitcher(): it adds/removes the admin-only
    // "Role Access" tab + panel from the DOM, so the tab scroller only
    // ever sees the tabs that actually exist for the logged-in role.
    stRoleAccessSetup();

    stApplyTheme(stGetSavedTheme());
    stThemeSwitcher();
    stTabSwitcher();
    stLanguageDropdown();
    stProfileForm();
    stAccountForm();

}

// =============================
// 1. Appearance — theme switcher
// =============================

function stGetSavedTheme() {

    return localStorage.getItem(ST_STORAGE_THEME) || "light";

}

function stApplyTheme(theme) {

    // Apply the theme to the document root so the shared shell,
    // sidebar, header and page-level CSS can react consistently.
    const normalized = theme === "dark" ? "dark" : "light";
    document.documentElement.setAttribute("data-theme", normalized);
    document.documentElement.style.colorScheme = normalized;

    const options = document.querySelectorAll(".st-theme-option");

    options.forEach((opt) => {

        const isSelected = opt.getAttribute("data-theme") === normalized;

        opt.classList.toggle("is-selected", isSelected);
        opt.setAttribute("aria-checked", isSelected ? "true" : "false");

    });

    localStorage.setItem(ST_STORAGE_THEME, normalized);

}

function stThemeSwitcher() {

    const options = document.querySelectorAll(".st-theme-option:not(.is-disabled)");

    if (!options.length) return;

    stApplyTheme(stGetSavedTheme());

    options.forEach((opt) => {

        opt.addEventListener("click", () => {

            const theme = opt.getAttribute("data-theme");

            stApplyTheme(theme);

            stShowToast(
                theme === "dark"
                    ? t("settings.appearance.darkToast")
                    : t("settings.appearance.lightToast")
            );

            // Dicatat sebagai kategori tersendiri "Change Theme" di
            // Activity Log (lihat AL_EVENT_GROUP/AL_TYPE_META di
            // js/activity-log.js) -- sebelumnya ganti tema tidak pernah
            // terkirim ke activity log sama sekali.
            if (typeof logActivity === "function") {
                logActivity({
                    eventType: "theme_change",
                    user: sessionStorage.getItem("edash-user") || "Anonymous",
                    userRole: sessionStorage.getItem("edash-role") || null,
                    status: "success",
                    detail: theme === "dark" ? "Switched dashboard theme to Dark" : "Switched dashboard theme to Light",
                    data: { theme: theme === "dark" ? "dark" : "light" },
                });
            }

        });

    });

}

// =============================
// Static tabs -- click a tab, show that panel (others display:none).
// Matches css/setting.css .st-panel/.is-active-panel toggle model.
// (Older horizontal-scroll/drag/wheel version replaced -- that CSS
// layout no longer exists in the current setting.css.)
// =============================

function stTabSwitcher() {

    const tabs = Array.from(document.querySelectorAll(".st-tab"));
    const panels = tabs
        .map((tab) => document.getElementById(tab.getAttribute("data-target")))
        .filter(Boolean);

    if (!tabs.length || !panels.length) return;

    function activate(tab) {
        if (!tab) return;

        const targetId = tab.getAttribute("data-target");

        tabs.forEach((item) => {
            const active = item === tab;
            item.classList.toggle("is-active", active);
            item.setAttribute("aria-selected", active ? "true" : "false");
        });

        panels.forEach((panel) => {
            panel.classList.toggle("is-active-panel", panel.id === targetId);
        });
    }

    tabs.forEach((tab) => {
        tab.addEventListener("click", () => activate(tab));
    });

    // Make sure whichever tab is already marked .is-active on load (or
    // the first tab, as a fallback) has its panel actually shown -- keeps
    // this in sync even if the HTML's initial is-active/is-active-panel
    // markup ever gets out of step.
    const initialTab = tabs.find((tab) => tab.classList.contains("is-active")) || tabs[0];
    activate(initialTab);

}

// =============================
// 2. Language dropdown
// =============================

function stLanguageDropdown() {

    const select = document.getElementById("stLanguageSelect");

    if (!select) return;

    select.value = getSavedLanguage();

    select.addEventListener("change", () => {

        applyLanguage(select.value);

        if (typeof logActivity === "function") {
            logActivity({
                eventType: "language_switch",
                user: sessionStorage.getItem("edash-user") || "Anonymous",
                userRole: sessionStorage.getItem("edash-role") || null,
                status: "success",
                detail: select.value === "id" ? "Switched dashboard language to Indonesian" : "Switched dashboard language to English",
                data: { language: select.value },
            });
        }

        stShowToast(
            select.value === "en"
                ? t("settings.language.toastEn")
                : t("settings.language.toastId")
        );

    });

}

// =============================
// 3. Profile form -- CONNECT PENUH KE DATABASE
// =============================
// Sebelum ini form Profile 100% palsu: value field di-hardcode langsung
// di HTML ("John Doe", dst) dan submit cuma nampilin toast tanpa
// benar-benar menyimpan apa pun. Sekarang:
// - Field diisi dari GET /auth/me (data akun yang LAGI LOGIN, dari
//   Postgres lewat backend Hono/edashboard_api) saat halaman dibuka.
// - Save Changes mengirim PUT /auth/profile (fullName/email/phone/
//   jobPosition) dan, kalau foto diganti/dihapus, PUT atau DELETE
//   /auth/profile/photo -- SEMUA lewat edashApiFetch() (cookie
//   session_token ikut otomatis), jadi backend selalu tahu persis siapa
//   yang login dan HANYA mengizinkan user mengubah profilnya SENDIRI
//   (userId diambil dari session di backend, bukan dari form/URL --
//   lihat AuthController.updateProfile/uploadProfilePhoto di
//   edashboard_api, tidak ada cara dari frontend untuk menyasar akun
//   orang lain).
function stProfileForm() {

    const form = document.getElementById("stProfileForm");

    if (!form) return;

    const saveBtn = document.getElementById("stProfileSave");
    const resetBtn = document.getElementById("stProfileReset");
    const saveState = document.getElementById("stProfileSaveState");
    const photoInput = document.getElementById("stPhotoInput");
    const photoRemove = document.getElementById("stPhotoRemove");
    const avatar = document.getElementById("stAvatarPreview");

    const fullNameInput = form.querySelector("#stFullName");
    const emailInput = form.querySelector("#stEmail");
    const phoneInput = form.querySelector("#stPhone");
    const positionInput = form.querySelector("#stPosition");

    // Snapshot data terakhir yang TERSIMPAN di server -- dipakai buat
    // Discard (kembali ke ini, BUKAN ke value hardcode lama di HTML) dan
    // buat tahu apakah foto benar-benar berubah saat submit.
    let savedProfile = { fullName: "", email: "", phoneNumber: "", jobPosition: "", photoUrl: null };
    // File foto baru yang dipilih user tapi BELUM di-upload (baru
    // benar-benar dikirim ke server saat "Save Changes" diklik, sama
    // seperti field teks lain -- supaya Discard bisa membatalkannya).
    let pendingPhotoFile = null;
    let pendingPhotoRemoved = false;

    function renderAvatar(photoUrl) {

        avatar.innerHTML = photoUrl
            ? `<img src="${photoUrl}" alt="Profile photo">`
            : `<i class="fa-solid fa-user"></i>`;

    }

    function applyProfileToForm(user) {

        savedProfile = {
            fullName: user.fullName || user.username || "",
            email: user.email || "",
            phoneNumber: user.phoneNumber || "",
            jobPosition: user.jobPosition || "",
            photoUrl: user.photoUrl || null,
        };

        fullNameInput.value = savedProfile.fullName;
        emailInput.value = savedProfile.email;
        phoneInput.value = savedProfile.phoneNumber;
        positionInput.value = savedProfile.jobPosition;

        renderAvatar(savedProfile.photoUrl);

        pendingPhotoFile = null;
        pendingPhotoRemoved = false;
        photoInput.value = "";

        stClearFieldErrors(form);
        saveBtn.disabled = true;
        saveState.classList.remove("is-visible");

    }

    // Muat profil akun yang lagi login. Dipanggil sekali saat halaman
    // Settings dibuka -- kalau gagal (mis. koneksi ke backend lagi
    // bermasalah), form dibiarkan kosong & user diberi tahu lewat toast
    // supaya tidak salah kira formnya memang belum ke-isi.
    (async function loadProfile() {

        saveBtn.disabled = true;

        try {

            const data = await edashApiFetch("/auth/me");
            const user = (data && data.user) ? data.user : data;

            if (user) applyProfileToForm(user);

        } catch (err) {

            console.warn("[setting] Gagal memuat profil dari /auth/me:", err.message || err);
            stShowToast("Gagal memuat data profil, coba muat ulang halaman");

        }

    })();

    // Enable Save button only once the form has unsaved changes.
    form.addEventListener("input", () => {

        saveBtn.disabled = false;
        saveState.classList.remove("is-visible");

    });

    // Photo upload preview -- validasi ringan di sisi client (tipe &
    // ukuran) supaya user langsung tahu kalau filenya tidak akan
    // diterima, TANPA menggantikan validasi asli di backend (lihat
    // avatar-upload.ts -- batas 2MB & JPG/PNG itu yang sebenarnya
    // menentukan, ini cuma UX cepat).
    if (photoInput && avatar) {

        photoInput.addEventListener("change", () => {

            const file = photoInput.files && photoInput.files[0];

            if (!file) return;

            const allowedTypes = ["image/jpeg", "image/png"];
            const maxBytes = 2 * 1024 * 1024;

            if (!allowedTypes.includes(file.type)) {
                stShowToast("Foto harus format JPG atau PNG");
                photoInput.value = "";
                return;
            }

            if (file.size > maxBytes) {
                stShowToast("Ukuran foto maksimal 2MB");
                photoInput.value = "";
                return;
            }

            const reader = new FileReader();

            reader.onload = () => {

                avatar.innerHTML = `<img src="${reader.result}" alt="Profile photo">`;
                pendingPhotoFile = file;
                pendingPhotoRemoved = false;
                saveBtn.disabled = false;
                saveState.classList.remove("is-visible");

            };

            reader.readAsDataURL(file);

        });

    }

    if (photoRemove && avatar) {

        photoRemove.addEventListener("click", () => {

            avatar.innerHTML = `<i class="fa-solid fa-user"></i>`;
            photoInput.value = "";
            pendingPhotoFile = null;
            // Cuma perlu benar-benar hapus di server kalau memang ada
            // foto tersimpan sebelumnya -- kalau belum ada foto sama
            // sekali, tidak ada apa-apa yang perlu dikirim ke DELETE.
            pendingPhotoRemoved = !!savedProfile.photoUrl;
            saveBtn.disabled = false;
            saveState.classList.remove("is-visible");

        });

    }

    if (resetBtn) {

        resetBtn.addEventListener("click", () => {

            // Kembali ke data TERAKHIR TERSIMPAN di server (savedProfile),
            // bukan form.reset() -- form.reset() akan balik ke value
            // attribute kosong di HTML, bukan ke data akun yang benar.
            fullNameInput.value = savedProfile.fullName;
            emailInput.value = savedProfile.email;
            phoneInput.value = savedProfile.phoneNumber;
            positionInput.value = savedProfile.jobPosition;

            renderAvatar(savedProfile.photoUrl);
            photoInput.value = "";
            pendingPhotoFile = null;
            pendingPhotoRemoved = false;

            stClearFieldErrors(form);
            saveBtn.disabled = true;
            saveState.classList.remove("is-visible");

        });

    }

    form.addEventListener("submit", (e) => {

        e.preventDefault();

        const isValid = stValidateProfile(form);

        if (!isValid) return;

        saveBtn.disabled = true;
        saveState.classList.remove("is-visible");

        (async function submitProfile() {

            try {

                // 1. Field teks (nama, email, telepon, posisi) -- selalu
                // dikirim, backend cuma benar-benar meng-update kolom
                // yang memang berubah (lihat AuthService.updateProfile).
                const payload = {
                    fullName: fullNameInput.value.trim(),
                    email: emailInput.value.trim(),
                    phoneNumber: phoneInput.value.trim(),
                    jobPosition: positionInput.value.trim(),
                };

                // Dibandingkan dengan savedProfile (snapshot SEBELUM submit
                // ini) supaya logActivity() di bawah cuma mencatat kategori
                // "Change Name/Profile Info" & "Change Profile Photo" kalau
                // memang ada perubahan di masing-masing, bukan asal kirim
                // keduanya setiap kali tombol Save Changes ditekan.
                const changedTextFields = [];
                if (payload.fullName !== savedProfile.fullName) changedTextFields.push("name");
                if (payload.email !== savedProfile.email) changedTextFields.push("email");
                if (payload.phoneNumber !== savedProfile.phoneNumber) changedTextFields.push("phone number");
                if (payload.jobPosition !== savedProfile.jobPosition) changedTextFields.push("job position");

                let data = await edashApiFetch("/auth/profile", {
                    method: "PUT",
                    body: JSON.stringify(payload),
                });

                // 2. Foto -- HANYA dikirim kalau memang berubah (file baru
                // dipilih ATAU tombol Remove diklik), supaya tidak ada
                // request kosong tiap kali Save Changes ditekan.
                // Disimpan di variabel terpisah SEBELUM applyProfileToForm()
                // di bawah, karena applyProfileToForm() me-reset
                // pendingPhotoFile/pendingPhotoRemoved ke null/false --
                // logActivity() di akhir fungsi ini butuh tahu foto memang
                // berubah atau tidak, jadi tidak bisa membaca dua variabel
                // itu lagi setelah applyProfileToForm() dipanggil.
                const photoWasUploaded = !!pendingPhotoFile;
                const photoWasRemoved = !photoWasUploaded && pendingPhotoRemoved;

                if (pendingPhotoFile) {

                    const form2 = new FormData();
                    form2.append("photo", pendingPhotoFile);

                    data = await edashApiFetch("/auth/profile/photo", {
                        method: "PUT",
                        body: form2,
                    });

                } else if (pendingPhotoRemoved) {

                    data = await edashApiFetch("/auth/profile/photo", {
                        method: "DELETE",
                    });

                }

                const user = (data && data.user) ? data.user : data;

                if (user) applyProfileToForm(user);

                // Update sessionStorage (Full Name & foto) LANGSUNG dari
                // response PUT di atas, dan re-render header/sidebar seketika
                // -- supaya "Save Changes" terasa instan, tidak nunggu round
                // trip /auth/me tambahan lagi. refreshUserSession() di bawah
                // (yang manggil /auth/me) tetap dijalankan sesudahnya sebagai
                // sumber kebenaran akhir & buat nyegarkan hal lain (role/
                // permission dst) sama seperti mekanisme Settings > Role
                // Access -- berlaku generik buat SEMUA role, tidak ada
                // percabangan per-role di sini.
                if (user) {
                    if (user.fullName || user.username) {
                        sessionStorage.setItem("edash-user-fullname", user.fullName || user.username);
                    }
                    if (user.photoUrl !== undefined) {
                        sessionStorage.setItem("edash-user-photo", user.photoUrl || "");
                    }
                    if (user.email !== undefined) {
                        sessionStorage.setItem("edash-user-email", user.email || "");
                    }
                    if (typeof populateHeaderProfile === "function") populateHeaderProfile();
                }

                if (typeof refreshUserSession === "function") refreshUserSession();

                saveState.innerHTML = `<i class="fa-solid fa-circle-check"></i> Saved`;
                saveState.classList.add("is-visible");

                stShowToast("Profile berhasil diperbarui");

                // Dipisah jadi 2 eventType supaya Activity Log punya kategori
                // sendiri-sendiri untuk "Change Profile Info" (nama/email/
                // telepon/posisi) dan "Change Profile Photo" (upload/hapus
                // foto) -- lihat AL_EVENT_GROUP/AL_TYPE_META di
                // js/activity-log.js. Sebelumnya keduanya digabung jadi satu
                // eventType "profile_update" generik ("Updated own profile
                // information") walau yang benar-benar berubah cuma salah
                // satunya (atau bahkan tidak ada perubahan sama sekali).
                if (typeof logActivity === "function") {

                    if (changedTextFields.length > 0) {
                        logActivity({
                            eventType: "profile_update",
                            user: sessionStorage.getItem("edash-user") || "Anonymous",
                            userRole: sessionStorage.getItem("edash-role") || null,
                            status: "success",
                            detail: `Updated profile info: ${changedTextFields.join(", ")}`,
                        });
                    }

                    if (photoWasUploaded || photoWasRemoved) {
                        logActivity({
                            eventType: "profile_photo_update",
                            user: sessionStorage.getItem("edash-user") || "Anonymous",
                            userRole: sessionStorage.getItem("edash-role") || null,
                            status: "success",
                            detail: photoWasUploaded ? "Updated profile photo" : "Removed profile photo",
                        });
                    }

                }

            } catch (err) {

                console.warn("[setting] Gagal menyimpan profil:", err.message || err);
                saveBtn.disabled = false;
                stShowToast(err.message || "Gagal menyimpan profil, coba lagi");

            }

        })();

    });

}

function stValidateProfile(form) {

    let isValid = true;

    const fullName = form.querySelector("#stFullName");
    const email = form.querySelector("#stEmail");
    const phone = form.querySelector("#stPhone");
    const position = form.querySelector("#stPosition");

    if (!stRequire(fullName)) isValid = false;
    if (!stValidateEmail(email)) isValid = false;
    if (!stValidatePhone(phone)) isValid = false;
    if (!stRequire(position)) isValid = false;

    return isValid;

}

// =============================
// 4. Account form (password)
// =============================

function stAccountForm() {

    const form = document.getElementById("stAccountForm");

    if (!form) return;

    const saveBtn = document.getElementById("stAccountSave");
    const resetBtn = document.getElementById("stAccountReset");
    const saveState = document.getElementById("stAccountSaveState");
    const usernameInput = document.getElementById("stUsername");
    const currentPassword = document.getElementById("stCurrentPassword");
    const newPassword = document.getElementById("stNewPassword");
    const confirmPassword = document.getElementById("stConfirmPassword");

    // Username sekarang BISA diedit di sini (dulu readonly & cuma
    // tampilan dari sessionStorage). Snapshot "terakhir tersimpan di
    // server" dipakai persis seperti savedProfile di stProfileForm --
    // supaya Discard kembali ke data server, dan supaya kita tahu
    // apakah username memang berubah saat submit (baru kirim PUT
    // /auth/profile kalau memang berubah).
    let savedUsername = sessionStorage.getItem("edash-user") || "";
    if (usernameInput) usernameInput.value = savedUsername;

    // Muat username terbaru dari server (bukan cuma sessionStorage yang
    // bisa basi) -- sama seperti loadProfile() di stProfileForm().
    (async function loadUsername() {
        try {
            const data = await edashApiFetch("/auth/me");
            const user = (data && data.user) ? data.user : data;
            if (user && user.username) {
                savedUsername = user.username;
                if (usernameInput && document.activeElement !== usernameInput) {
                    usernameInput.value = savedUsername;
                }
            }
        } catch (err) {
            console.warn("[setting] Gagal memuat username dari /auth/me:", err.message || err);
        }
    })();

    // Show / hide password
    document.querySelectorAll(".st-password-toggle").forEach((btn) => {

        btn.addEventListener("click", () => {

            const input = document.getElementById(btn.getAttribute("data-target"));

            if (!input) return;

            const isHidden = input.type === "password";

            input.type = isHidden ? "text" : "password";

            btn.innerHTML = isHidden
                ? `<i class="fa-regular fa-eye-slash"></i>`
                : `<i class="fa-regular fa-eye"></i>`;

        });

    });

    // Live password strength meter
    if (newPassword) {

        newPassword.addEventListener("input", () => {

            stUpdatePasswordStrength(newPassword.value);

        });

    }

    form.addEventListener("input", () => {

        saveBtn.disabled = false;
        saveState.classList.remove("is-visible");

    });

    if (resetBtn) {

        resetBtn.addEventListener("click", () => {

            form.reset();
            // Kembali ke data TERAKHIR TERSIMPAN di server (savedUsername),
            // bukan form.reset() saja -- sama alasannya seperti Discard di
            // stProfileForm().
            if (usernameInput) usernameInput.value = savedUsername;
            stClearFieldErrors(form);
            stUpdatePasswordStrength("");
            saveBtn.disabled = true;
            saveState.classList.remove("is-visible");

        });

    }

    form.addEventListener("submit", async (e) => {

        e.preventDefault();

        const isValid = stValidateAccount(form);

        if (!isValid) return;

        if (typeof window.edashApiFetch !== "function") {
            stShowToast("Tidak bisa terhubung ke server, coba muat ulang halaman.");
            return;
        }

        saveBtn.disabled = true;
        saveState.classList.remove("is-visible");

        const newUsername = usernameInput ? usernameInput.value.trim() : savedUsername;
        const usernameChanged = newUsername !== savedUsername;
        const wantsPasswordChange = !!(currentPassword.value || newPassword.value || confirmPassword.value);

        try {

            // 1. Username -- HANYA dikirim kalau memang berubah, lewat PUT
            // /auth/profile (endpoint yang sama dipakai stProfileForm buat
            // nama/email/telepon/posisi). Ini TIDAK butuh currentPassword,
            // jadi user boleh ganti username tanpa harus sekalian ganti
            // password. userId tetap dari session di backend (bukan dari
            // body), jadi tetap cuma bisa ganti username akun sendiri.
            if (usernameChanged) {

                let data;
                try {
                    data = await window.edashApiFetch("/auth/profile", {
                        method: "PUT",
                        body: JSON.stringify({ username: newUsername }),
                    });
                } catch (err) {
                    if (err.code === "USERNAME_ALREADY_EXISTS") {
                        stSetFieldState(usernameInput, false);
                        const errorEl = form.querySelector('[data-error="stUsername"]');
                        if (errorEl) errorEl.textContent = "Username sudah digunakan.";
                    }
                    throw err;
                }

                const user = (data && data.user) ? data.user : data;

                // Update sessionStorage + header/sidebar SEKETIKA -- sama
                // seperti submitProfile() di stProfileForm(), supaya nama
                // login yang tampil di Admin View & header ikut berubah
                // tanpa nunggu pindah halaman dulu (refreshUserSession()
                // di bawah tetap dipanggil sebagai sumber kebenaran akhir).
                if (user && user.username) {
                    savedUsername = user.username;
                    sessionStorage.setItem("edash-user", user.username);
                    if (usernameInput) usernameInput.value = savedUsername;
                    if (typeof populateHeaderProfile === "function") populateHeaderProfile();
                }

                if (typeof logActivity === "function") {
                    logActivity({
                        eventType: "profile_update",
                        user: savedUsername,
                        userRole: sessionStorage.getItem("edash-role") || null,
                        status: "success",
                        detail: "Updated profile info: username",
                    });
                }

            }

            // 2. Password -- currentPassword + newPassword SAJA yang
            // dikirim. Backend (PUT /auth/change-password) mengambil user
            // yang mau diganti password-nya dari session cookie yang
            // login, BUKAN dari body, jadi akun ini cuma bisa ganti
            // password miliknya sendiri, tidak bisa ganti password akun
            // lain.
            if (wantsPasswordChange) {

                await window.edashApiFetch("/auth/change-password", {
                    method: "PUT",
                    body: JSON.stringify({
                        currentPassword: currentPassword.value,
                        newPassword: newPassword.value,
                    }),
                });

                if (typeof logActivity === "function") {
                    logActivity({
                        eventType: "password_change",
                        user: savedUsername,
                        userRole: sessionStorage.getItem("edash-role") || null,
                        status: "success",
                        detail: "Successfully changed account password",
                    });
                }

            }

            if (typeof refreshUserSession === "function") refreshUserSession();

            saveState.innerHTML = `<i class="fa-solid fa-circle-check"></i> Updated`;
            saveState.classList.add("is-visible");

            stShowToast(
                usernameChanged && wantsPasswordChange
                    ? "Username dan password berhasil diperbarui"
                    : usernameChanged
                        ? "Username berhasil diperbarui"
                        : "Password berhasil diperbarui"
            );

            form.reset();
            if (usernameInput) usernameInput.value = savedUsername;
            stUpdatePasswordStrength("");
            stClearFieldErrors(form);

        } catch (err) {

            // INVALID_CURRENT_PASSWORD -- tandai field currentPassword
            // secara spesifik supaya user tahu persis field mana yang
            // salah, bukan cuma toast generik.
            if (err.code === "INVALID_CURRENT_PASSWORD") {
                stSetFieldState(currentPassword, false);
                const errorEl = form.querySelector('[data-error="stCurrentPassword"]');
                if (errorEl) errorEl.textContent = "Password saat ini salah.";
            }

            stShowToast(err.message || "Gagal memperbarui akun");

            if (typeof logActivity === "function") {
                logActivity({
                    eventType: usernameChanged && !wantsPasswordChange ? "profile_update" : "password_change",
                    user: sessionStorage.getItem("edash-user") || "Anonymous",
                    userRole: sessionStorage.getItem("edash-role") || null,
                    status: "failed",
                    detail: `Failed to update account — ${err.message || "unknown error"}`,
                });
            }

            saveBtn.disabled = false;

        }

    });

}

function stValidateAccount(form) {

    let isValid = true;

    const username = form.querySelector("#stUsername");
    const currentPassword = form.querySelector("#stCurrentPassword");
    const newPassword = form.querySelector("#stNewPassword");
    const confirmPassword = form.querySelector("#stConfirmPassword");

    if (!stRequire(username)) isValid = false;

    // Password fields are only validated (and only required) when the
    // user is actually trying to change their password -- username can
    // now be saved on its own, without also being forced to fill in
    // currentPassword/newPassword/confirmPassword every time.
    const wantsPasswordChange = !!(currentPassword.value || newPassword.value || confirmPassword.value);

    if (wantsPasswordChange) {

        if (!stRequire(currentPassword)) isValid = false;

        if (!newPassword.value || newPassword.value.length < 8) {
            stSetFieldState(newPassword, false);
            isValid = false;
        } else {
            stSetFieldState(newPassword, true);
        }

        if (!confirmPassword.value || confirmPassword.value !== newPassword.value) {
            stSetFieldState(confirmPassword, false);
            isValid = false;
        } else {
            stSetFieldState(confirmPassword, true);
        }

    } else {
        stSetFieldState(currentPassword, true);
        stSetFieldState(newPassword, true);
        stSetFieldState(confirmPassword, true);
    }

    return isValid;

}

function stUpdatePasswordStrength(value) {

    const bar = document.querySelector("#stPasswordStrength .st-strength-bar i");
    const label = document.querySelector("#stPasswordStrength .st-strength-label");

    if (!bar || !label) return;

    let score = 0;

    if (value.length >= 8) score += 1;
    if (/[A-Z]/.test(value)) score += 1;
    if (/[0-9]/.test(value)) score += 1;
    if (/[^A-Za-z0-9]/.test(value)) score += 1;

    const levels = [
        { width: "0%",   color: "var(--st-border)",  text: "Password strength" },
        { width: "25%",  color: "var(--st-danger)",  text: "Weak" },
        { width: "50%",  color: "var(--st-warning)", text: "Fair" },
        { width: "75%",  color: "var(--st-info)",    text: "Good" },
        { width: "100%", color: "var(--st-success)", text: "Strong" }
    ];

    const level = value ? levels[score] : levels[0];

    bar.style.width = level.width;
    bar.style.background = level.color;
    label.textContent = level.text;

}

// =============================
// Shared validation helpers
// =============================

function stSetFieldState(input, isValid) {

    const field = input.closest(".st-field");

    if (!field) return;

    field.classList.toggle("is-invalid", !isValid);
    field.classList.toggle("is-valid", isValid);

}

function stRequire(input) {

    const ok = !!input.value.trim();

    stSetFieldState(input, ok);

    return ok;

}

function stValidateEmail(input) {

    const pattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    const ok = pattern.test(input.value.trim());

    stSetFieldState(input, ok);

    return ok;

}

function stValidatePhone(input) {

    const pattern = /^[0-9+\-\s()]{8,}$/;
    const ok = pattern.test(input.value.trim());

    stSetFieldState(input, ok);

    return ok;

}

function stClearFieldErrors(form) {

    form.querySelectorAll(".st-field").forEach((field) => {

        field.classList.remove("is-invalid", "is-valid");

    });

}

// =============================
// Toast
// =============================

let stToastTimer = null;

function stShowToast(message) {

    const toast = document.getElementById("stToast");
    const msg = document.getElementById("stToastMsg");

    if (!toast || !msg) return;

    msg.textContent = message;
    toast.classList.add("is-visible");

    clearTimeout(stToastTimer);

    stToastTimer = setTimeout(() => {

        toast.classList.remove("is-visible");

    }, 2600);

}
// =============================
// 5. Role Access (root only) -- CONNECT PENUH KE DATABASE
// =============================
// Visibility: sessionStorage "edash-role" diisi saat login. Cuma role
// "root" (360master) yang boleh lihat/edit tab ini -- lihat
// stIsAdmin360() (sudah diperbaiki sebelumnya, cek "root" bukan lagi
// "admin360").
//
// PERUBAHAN DARI VERSI SEBELUMNYA:
// - Fitur "Add Role" / "Rename Role" / "Delete Role" DIHAPUS. Role di
//   sistem ini FIXED (7 role tetap di tabel `roles`, bukan sesuatu
//   yang bisa ditambah/diubah bebas dari UI) -- root cuma boleh
//   TOGGLE permission per role, bukan bikin kategori role baru.
//   Create/Delete AKUN (bukan ROLE) itu sudah ada tempatnya sendiri
//   di halaman Admin View, tidak didobel di sini.
// - State permission sekarang dari database (GET/PUT
//   /api/v1/settings/role-permissions), BUKAN localStorage lagi.
//
// 360Master/root sendiri TIDAK muncul sebagai kolom di sini -- dia
// selalu full access, tidak pernah ada baris untuknya di
// role_permissions (sesuai desain database).

const ST_ROLE_ACCESS_ROLES = [
    { key: "bioflocLead", dbKey: "biofloc_intern_lead", labelKey: "settings.roleAccess.roles.bioflocLead", color: "#3E7CB1" },
    { key: "remsLead", dbKey: "rems_intern_lead", labelKey: "settings.roleAccess.roles.remsLead", color: "#FA891A" },
    { key: "bioflocIntern", dbKey: "biofloc_intern", labelKey: "settings.roleAccess.roles.bioflocIntern", color: "#3E7CB1" },
    { key: "remsIntern", dbKey: "rems_intern", labelKey: "settings.roleAccess.roles.remsIntern", color: "#FA891A" },
    { key: "operator", dbKey: "operator", labelKey: "settings.roleAccess.roles.operator", color: "#0F6A71" },
    { key: "staff", dbKey: "staff", labelKey: "settings.roleAccess.roles.staff", color: "#E3A21A" }
];

function stRoleAccessLabel(role) {
    return t(role.labelKey) || role.key;
}

// Rows mirror the pages/actions that actually exist in the Admin 360
// sidebar. "code" di tiap capability ini SENGAJA persis sama dengan
// permission_key di database (tabel `permissions`) -- itu yang dipakai
// buat manggil API, jangan diubah tanpa sinkronkan ke backend juga.
const ST_ROLE_ACCESS_CAPABILITIES = [
    {
        key: "dashboard.view",
        titleKey: "settings.roleAccess.cap.dashboard.title",
        descKey: "settings.roleAccess.cap.dashboard.desc",
        code: "dashboard.view",
        default: { bioflocLead: 1, remsLead: 1, bioflocIntern: 1, remsIntern: 1, operator: 1, staff: 1 }
    },
    {
        key: "project.monitor",
        titleKey: "settings.roleAccess.cap.monitor.title",
        descKey: "settings.roleAccess.cap.monitor.desc",
        code: "project.monitoring",
        default: { bioflocLead: 1, remsLead: 1, bioflocIntern: 1, remsIntern: 1, operator: 1, staff: 1 }
    },
    {
        key: "battery.view",
        titleKey: "settings.roleAccess.cap.battery.title",
        descKey: "settings.roleAccess.cap.battery.desc",
        code: "battery.view",
        default: { bioflocLead: 1, remsLead: 1, bioflocIntern: 1, remsIntern: 1, operator: 1, staff: 1 }
    },
    {
        key: "alert.ack",
        titleKey: "settings.roleAccess.cap.alert.title",
        descKey: "settings.roleAccess.cap.alert.desc",
        code: "alert.ack",
        default: { bioflocLead: 1, remsLead: 1, bioflocIntern: 0, remsIntern: 0, operator: 1, staff: 1 }
    },
    {
        key: "task.management",
        titleKey: "settings.roleAccess.cap.taskManagement.title",
        descKey: "settings.roleAccess.cap.taskManagement.desc",
        code: "task.management",
        default: { bioflocLead: 1, remsLead: 1, bioflocIntern: 0, remsIntern: 0, operator: 1, staff: 0 }
    },
    {
        key: "task.maintenance",
        titleKey: "settings.roleAccess.cap.taskMaintenance.title",
        descKey: "settings.roleAccess.cap.taskMaintenance.desc",
        code: "task.maintenance",
        default: { bioflocLead: 1, remsLead: 1, bioflocIntern: 0, remsIntern: 0, operator: 0, staff: 1 }
    },
    {
        key: "calculator.use",
        titleKey: "settings.roleAccess.cap.calculator.title",
        descKey: "settings.roleAccess.cap.calculator.desc",
        code: "calculator.use",
        default: { bioflocLead: 1, remsLead: 1, bioflocIntern: 0, remsIntern: 0, operator: 0, staff: 0 }
    },
    {
        key: "catalog.view",
        titleKey: "settings.roleAccess.cap.catalog.title",
        descKey: "settings.roleAccess.cap.catalog.desc",
        code: "catalog.view",
        default: { bioflocLead: 1, remsLead: 1, bioflocIntern: 1, remsIntern: 1, operator: 0, staff: 0 }
    },
    {
        key: "project.create",
        titleKey: "settings.roleAccess.cap.projectCreate.title",
        descKey: "settings.roleAccess.cap.projectCreate.desc",
        code: "project.create",
        default: { bioflocLead: 1, remsLead: 1, bioflocIntern: 0, remsIntern: 0, operator: 0, staff: 0 }
    },
    {
        key: "adminview.access",
        titleKey: "settings.roleAccess.cap.adminView.title",
        descKey: "settings.roleAccess.cap.adminView.desc",
        code: "adminview.access",
        default: { bioflocLead: 1, remsLead: 1, bioflocIntern: 0, remsIntern: 0, operator: 0, staff: 0 }
    },
    {
        key: "activitylog.view",
        titleKey: "settings.roleAccess.cap.activityLog.title",
        descKey: "settings.roleAccess.cap.activityLog.desc",
        code: "activitylog.view",
        default: { bioflocLead: 1, remsLead: 1, bioflocIntern: 0, remsIntern: 0, operator: 0, staff: 0 }
    },
    {
        key: "users.manage",
        titleKey: "settings.roleAccess.cap.usersManage.title",
        descKey: "settings.roleAccess.cap.usersManage.desc",
        code: "users.manage",
        default: { bioflocLead: 0, remsLead: 0, bioflocIntern: 0, remsIntern: 0, operator: 0, staff: 0 }
    }
];

function stRoleAccessDefaultState() {
    const state = {};
    ST_ROLE_ACCESS_CAPABILITIES.forEach((cap) => {
        state[cap.key] = Object.assign({}, cap.default);
    });
    return state;
}

let stRoleAccessState = null;

// Load matrix asli dari database (GET /settings/role-permissions),
// bukan localStorage lagi. Kalau API gagal (offline/error), fallback
// ke default hardcode supaya UI tidak kosong total -- tapi toggle
// tidak akan tersimpan sampai koneksi pulih (setiap toggle langsung
// PUT ke server, lihat stRoleAccessRenderTable).
async function stRoleAccessLoadState() {

    stRoleAccessState = stRoleAccessDefaultState();

    if (typeof window.edashApiFetch !== "function") return;

    try {
        // edashApiFetch: auto-redirect ke login kalau 401 (sesi expired)
        // & auto-timeout -- sebelumnya raw fetch() di sini gak punya
        // keduanya, jadi kalau sesi expired pas buka Settings, yang
        // kejadian cuma toast error generik & diam-diam fallback ke
        // default, bukan diarahkan ke login kayak halaman lain.
        const data = await window.edashApiFetch("/settings/role-permissions");

        // data.capabilities: [{ permissionKey, byRole: { role_key: bool } }]
        const byCode = {};
        data.capabilities.forEach((cap) => { byCode[cap.permissionKey] = cap.byRole; });

        ST_ROLE_ACCESS_CAPABILITIES.forEach((cap) => {
            const fromApi = byCode[cap.code];
            if (!fromApi) return; // permission belum ada di server, pakai default
            ST_ROLE_ACCESS_ROLES.forEach((role) => {
                if (role.dbKey in fromApi) {
                    stRoleAccessState[cap.key][role.key] = fromApi[role.dbKey] ? 1 : 0;
                }
            });
        });

    } catch (err) {
        console.error("[setting] Gagal memuat role-permissions dari server, pakai default:", err);
        stShowToast(t("settings.roleAccess.loadFailedToast") || "Gagal memuat permission dari server");
    }

}

// Toggle 1 checkbox = 1 PUT request langsung ke server (bukan simpan
// batch) -- supaya kalau ada 2 admin buka Settings bersamaan, tidak
// ada yang perubahannya ketiban/hilang gara-gara "save semua sekaligus".
async function stRoleAccessPersistToggle(capCode, roleDbKey, allowed) {

    if (typeof window.edashApiFetch !== "function") throw new Error("edashApiFetch belum dimuat");

    await window.edashApiFetch("/settings/role-permissions", {
        method: "PUT",
        body: JSON.stringify({ roleKey: roleDbKey, permissionKey: capCode, allowed }),
    });

}

function stRoleAccessRenderTable() {

    const wrap = document.getElementById("stRoleAccessTableWrap");
    if (!wrap || !stRoleAccessState) return;

    const allRoles = ST_ROLE_ACCESS_ROLES;

    const roleHeadCells = allRoles.map((role) => `
        <th scope="col" class="st-ra-role-head" style="color:${role.color}; border-bottom-color:${role.color};">
            <span class="st-ra-role-name">${stRoleAccessLabel(role)}</span>
        </th>
    `).join("");

    const bodyRows = ST_ROLE_ACCESS_CAPABILITIES.map((cap) => {

        const cells = allRoles.map((role) => {
            const checked = !!stRoleAccessState[cap.key][role.key];
            return `
                <td class="st-ra-cell">
                    <label class="st-ra-switch">
                        <input
                            type="checkbox"
                            data-cap="${cap.key}"
                            data-code="${cap.code}"
                            data-role="${role.key}"
                            data-db-role="${role.dbKey}"
                            ${checked ? "checked" : ""}
                        >
                        <span class="st-ra-track"><span class="st-ra-thumb"></span></span>
                    </label>
                </td>
            `;
        }).join("");

        return `
            <tr>
                <th scope="row" class="st-ra-cap-head">
                    <span class="st-ra-cap-title">
                        <span data-i18n="${cap.titleKey}">${t(cap.titleKey)}</span>
                    </span>
                    <span class="st-ra-cap-desc" data-i18n="${cap.descKey}">${t(cap.descKey)}</span>
                    <code class="st-ra-cap-code">${cap.code}</code>
                </th>
                ${cells}
            </tr>
        `;

    }).join("");

    wrap.innerHTML = `
        <table class="st-ra-table">
            <thead>
                <tr>
                    <th scope="col" class="st-ra-cap-col-head" data-i18n="settings.roleAccess.capabilityCol">${t("settings.roleAccess.capabilityCol")}</th>
                    ${roleHeadCells}
                </tr>
            </thead>
            <tbody>
                ${bodyRows}
            </tbody>
        </table>
    `;

    wrap.querySelectorAll('input[type="checkbox"]').forEach((input) => {

        input.addEventListener("change", async (event) => {

            const capKey = event.target.getAttribute("data-cap");
            const capCode = event.target.getAttribute("data-code");
            const roleKey = event.target.getAttribute("data-role");
            const roleDbKey = event.target.getAttribute("data-db-role");
            const newValue = event.target.checked;

            if (!capKey || !roleKey || !stRoleAccessState[capKey]) return;

            // Optimistic update di UI, rollback kalau API gagal.
            const previousValue = !!stRoleAccessState[capKey][roleKey];
            stRoleAccessState[capKey][roleKey] = newValue ? 1 : 0;
            event.target.disabled = true;

            try {
                await stRoleAccessPersistToggle(capCode, roleDbKey, newValue);

                const role = allRoles.find((r) => r.key === roleKey);
                const roleLabel = role ? stRoleAccessLabel(role) : "";
                const toastMsg = roleLabel
                    ? t("settings.roleAccess.updateToastRole").replace("{role}", roleLabel)
                    : t("settings.roleAccess.updateToast");
                stShowToast(toastMsg);

            } catch (err) {
                console.error("[setting] Gagal simpan toggle permission:", err);
                stRoleAccessState[capKey][roleKey] = previousValue ? 1 : 0;
                event.target.checked = previousValue;
                stShowToast(err.message || "Gagal menyimpan perubahan");
            } finally {
                event.target.disabled = false;
            }

        });

    });

}

function stRoleAccessBindReset() {

    const resetBtn = document.getElementById("stRoleAccessReset");
    if (!resetBtn || resetBtn.dataset.bound) return;
    resetBtn.dataset.bound = "true";

    resetBtn.addEventListener("click", async () => {

        resetBtn.disabled = true;
        const defaults = stRoleAccessDefaultState();

        try {
            // Kirim SEMUA kombinasi cap x role balik ke nilai default --
            // ini beneran nulis ke database (bukan cuma reset tampilan),
            // supaya "Reset to Default" konsisten untuk semua orang yang
            // buka Settings, bukan cuma reset lokal di browser ini saja.
            const jobs = [];
            ST_ROLE_ACCESS_CAPABILITIES.forEach((cap) => {
                ST_ROLE_ACCESS_ROLES.forEach((role) => {
                    const value = !!defaults[cap.key][role.key];
                    jobs.push(stRoleAccessPersistToggle(cap.code, role.dbKey, value));
                });
            });
            await Promise.all(jobs);

            stRoleAccessState = defaults;
            stRoleAccessRenderTable();
            stShowToast(t("settings.roleAccess.resetToast"));

        } catch (err) {
            console.error("[setting] Gagal reset permission ke default:", err);
            stShowToast(err.message || "Gagal reset ke default");
        } finally {
            resetBtn.disabled = false;
        }

    });

}

// Cuma role "root" (360Master/Admin Master) yang boleh lihat/edit tab
// Role Access. sessionStorage "edash-role" diisi dari roleKey asli
// backend saat login (lihat js/login.js) -- BUKAN lagi enum lama
// "admin360" yang dipakai versi sebelumnya.
function stIsAdmin360() {

    const roleKey = sessionStorage.getItem("edash-role");

    // Log diagnostik sementara -- buka DevTools Console (F12) di halaman
    // Settings untuk lihat role yang benar-benar terbaca browser saat ini.
    // Kalau nilainya bukan "root" padahal login pakai akun admin master,
    // berarti masalahnya ada di response login / akun di database, bukan
    // di file ini. Aman dihapus kapan saja setelah tidak dibutuhkan lagi.
    console.log("[setting] stIsAdmin360 check — sessionStorage edash-role:", roleKey);

    return roleKey === "root";

}

async function stRoleAccessSetup() {

    const tab = document.getElementById("stRoleAccessTab");
    const panel = document.getElementById("stRoleAccess");

    if (!stIsAdmin360()) {
        if (tab) tab.remove();
        if (panel) panel.remove();
        return;
    }

    if (tab) tab.hidden = false;
    if (panel) panel.hidden = false;

    const tabsEl = document.getElementById("stTabs");
    if (tabsEl) {
        const visibleTabCount = tabsEl.querySelectorAll(".st-tab").length;
        tabsEl.style.setProperty("--st-tab-count", String(visibleTabCount));
    }

    const wrap = document.getElementById("stRoleAccessTableWrap");
    if (wrap) wrap.innerHTML = `<div class="st-ra-loading">${t("loading") || "Loading…"}</div>`;

    await stRoleAccessLoadState();
    stRoleAccessRenderTable();
    stRoleAccessBindReset();

}
