async function login() {
    const username = document.getElementById("email").value.trim();
    const password = document.getElementById("password").value.trim();

    if (!username || !password) {
        alert("Username dan password wajib diisi");
        return;
    }

    try {
        const res = await fetch("/login", {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                username: username,
                password: password
            })
        });

        const data = await res.json();

        if (!res.ok) {
            alert(data.message || "Login gagal");
            return;
        }

        // Simpan token ke localStorage
        localStorage.setItem("token", data.token);

        alert("Login berhasil!");
        window.location.href = "/admin/dashboard.html";

    } catch (error) {
        console.error("Error:", error);
        alert("Server tidak bisa dihubungi");
    }
}
