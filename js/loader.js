function initLoader() {
	firebase.auth().onAuthStateChanged(user => {
		window.location.href = user ? "pages/home.html" : "pages/auth.html";
	});
}

initLoader();
