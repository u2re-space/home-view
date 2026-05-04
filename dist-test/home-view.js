//#region \0rolldown/runtime.js
var e = Object.defineProperty, t = (t, n) => {
	let r = {};
	for (var i in t) e(r, i, {
		get: t[i],
		enumerable: !0
	});
	return n || e(r, Symbol.toStringTag, { value: "Module" }), r;
}, n = {
	ViewerPushToWorkcenter: "viewer.attach-to-workcenter",
	WorkcenterAttach: "attach-files",
	WorkcenterFileAttach: "file-attach",
	WorkcenterShare: "content-share"
}, r = {
	WallpaperSet: "workspace.wallpaper-set",
	WallpaperFromFile: "workspace.wallpaper-from-file",
	SpeedDialPinHref: "workspace.speed-dial-pin-href",
	SpeedDialPinFile: "workspace.speed-dial-pin-file"
};
n.ViewerPushToWorkcenter;
var i = {
	Navigate: "navigate",
	OpenView: "open-view",
	...r
}, a = /* @__PURE__ */ t({
	HomeView: () => o,
	createHomeView: () => c,
	createView: () => s,
	default: () => s
}), o = class {
	constructor(e = {}) {
		this.id = "home", this.name = "Home", this.icon = "house", this.element = null, this.lifecycle = { onUnmount: () => {
			this.element = null;
		} }, this.options = e, this.shellContext = e.shellContext;
	}
	render(e) {
		e && (this.options = {
			...this.options,
			...e
		}, this.shellContext = e.shellContext ?? this.shellContext);
		let t = document.createElement("section");
		return t.className = "view-home", t.dataset.view = "home", t.innerHTML = "\n            <header class=\"view-home__header\">\n                <h1 class=\"view-home__title\">U2RE Space</h1>\n                <p class=\"view-home__subtitle\">Pick a workspace view to continue.</p>\n            </header>\n            <nav class=\"view-home__nav\" aria-label=\"Quick open\">\n                <button type=\"button\" class=\"view-home__btn\" data-open=\"workcenter\">Work Center</button>\n                <button type=\"button\" class=\"view-home__btn\" data-open=\"viewer\">Viewer</button>\n                <button type=\"button\" class=\"view-home__btn\" data-open=\"explorer\">Explorer</button>\n                <button type=\"button\" class=\"view-home__btn\" data-open=\"settings\">Settings</button>\n            </nav>\n        ", t.querySelectorAll("[data-open]").forEach((e) => {
			e.addEventListener("click", () => {
				let t = e.dataset.open;
				t && this.shellContext?.navigate?.(t);
			});
		}), this.element = t, t;
	}
	invokeChannelApi(e, t) {
		if (e !== i.Navigate && e !== i.OpenView) return;
		let n = typeof t == "string" ? t : t && typeof t == "object" && "viewId" in t ? String(t.viewId) : "";
		return n.trim() ? (this.shellContext?.navigate?.(n.trim()), !0) : !1;
	}
};
function s(e) {
	return new o(e);
}
var c = s;
//#endregion
//#region ../../projects/subsystem/types.ts
function l(e) {
	if (typeof e != "function" || typeof HTMLElement > "u") return !1;
	let t = e.prototype;
	return !!(t && HTMLElement.prototype.isPrototypeOf(t));
}
function u(e) {
	return !!(e && typeof e == "object" && typeof e.render == "function");
}
function d(e) {
	return typeof HTMLElement < "u" && e instanceof HTMLElement;
}
function f(e, t = {}) {
	let n = [
		e.createView,
		e.createHomeView,
		e.createMarkdownViewer,
		e.createViewerView,
		e.createExplorerView,
		e.createEditorView,
		e.createHistoryView,
		e.createSettingsView,
		e.createWorkCenterView,
		e.createAirpadView,
		e.default
	];
	for (let e of n) if (e) {
		if (u(e) || d(e)) return e;
		if (l(e)) return new e();
		if (typeof e == "function") return e(t);
	}
	throw Error("View module must export default/createView or a named create*View factory");
}
function p(e, t = {}) {
	return d(e) ? e : e.render(t);
}
//#endregion
//#region ../../projects/subsystem/test/module-smoke.ts
var m = a;
if (!m.default && !m.createView) throw Error("home-view must export default or createView");
if (typeof document < "u" && !(p(f(m, { id: "home-view" }), { id: "home-view" }) instanceof HTMLElement)) throw Error("home-view did not render an HTMLElement");
//#endregion
