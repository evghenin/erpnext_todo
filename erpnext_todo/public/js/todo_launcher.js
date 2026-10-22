frappe.provide("erpnext_todo");

const TODO_QUEUE = "erpnext_todo.api.todo_queue";
const PAGE_SIZE = 20;
const MAX_ROWS = 40;
const PRIORITIES = ["High", "Medium", "Low"];
const STATUSES = ["Open", "Closed", "Cancelled"];

erpnext_todo.launcher = {
	PAGE_SIZE,
	MAX_ROWS,
	counts: { High: 0, Medium: 0, Low: 0 },
	hasOverdue: false,
	open: false,
	priority: null,
	expanded: null,
	returnToTask: false,
	solo: false,
	rows: [],
	queue: [],
	queueReady: false,
	detail: null,
	scrollTop: 0,
	hasMore: false,
	loading: false,
	error: "",
	statusPending: null,
	listToken: 0,
	detailToken: 0,
	countToken: 0,
	refreshTimer: null,
	phase: "closed",
	motionToken: 0,
	countsReady: false,
	pendingBell: false,

	start() {
		if (frappe.session.user === "Guest") {
			return;
		}
		this.ensureDom();
		this.bindRealtime();
		this.bindSoundSync();
		this.loadCounts();
	},

	ensureDom() {
		if (this.root) {
			return;
		}
		this.root = document.createElement("section");
		this.root.className = "todo-launcher";
		this.root.innerHTML = `
			<div class="todo-launcher__panel">
				<div class="todo-launcher__sheet">
					<div class="todo-launcher__header">
						<span class="todo-launcher__title"></span>
						<button type="button" class="todo-launcher__collapse"></button>
					</div>
					<div class="todo-launcher__error" hidden></div>
					<div class="todo-launcher__body"></div>
				</div>
			</div>
			<div class="todo-launcher__tab" role="group" aria-expanded="false">
				<button type="button" class="todo-launcher__icon"></button>
				<span class="todo-launcher__counts"></span>
				<span class="todo-launcher__overdue" hidden></span>
				<button type="button" class="todo-launcher__sound"></button>
			</div>
		`;
		this.panel = this.root.querySelector(".todo-launcher__panel");
		this.sheet = this.root.querySelector(".todo-launcher__sheet");
		this.title = this.root.querySelector(".todo-launcher__title");
		this.collapseBtn = this.root.querySelector(".todo-launcher__collapse");
		this.errorEl = this.root.querySelector(".todo-launcher__error");
		this.body = this.root.querySelector(".todo-launcher__body");
		this.tab = this.root.querySelector(".todo-launcher__tab");
		this.iconBtn = this.root.querySelector(".todo-launcher__icon");
		this.countsEl = this.root.querySelector(".todo-launcher__counts");
		this.overdueEl = this.root.querySelector(".todo-launcher__overdue");
		this.soundBtn = this.root.querySelector(".todo-launcher__sound");
		this.soundMuted = this.readSoundMuted();
		this.iconBtn.innerHTML = frappe.utils.icon("list", "md");
		this.renderSound();
		this.collapseBtn.innerHTML = frappe.utils.icon("close", "sm");
		this.title.textContent = __("ToDo");
		this.tab.setAttribute("aria-label", __("ToDo"));
		this.iconBtn.setAttribute("aria-label", __("All"));
		this.collapseBtn.setAttribute("aria-label", __("Collapse"));
		this.overdueEl.title = __("Overdue");
		this.tab.addEventListener("click", (event) => this.onBarClick(event));
		this.collapseBtn.addEventListener("click", () => this.closeManual());
		this.body.addEventListener("scroll", () => {
			this.scrollTop = this.body.scrollTop;
		});
		this.observer = new IntersectionObserver(
			(entries) => {
				if (entries.some((entry) => entry.isIntersecting)) {
					this.loadMore();
				}
			},
			{ root: this.body, threshold: 0.1 }
		);
		document.body.appendChild(this.root);
		this.syncBarHeight();
		if (!this.keyBound) {
			this.keyBound = true;
			document.addEventListener("keydown", (event) => this.onKeydown(event));
		}
		this.renderTab();
	},

	bindRealtime() {
		this.onQueueChanged = () => this.scheduleRefresh();
		this.onListUpdate = (payload) => {
			if (payload && payload.doctype === "ToDo") {
				this.scheduleRefresh();
			}
		};
		const subscribe = () => {
			const socket = frappe.realtime && frappe.realtime.socket;
			if (!socket) {
				return false;
			}
			frappe.realtime.off("erpnext_todo_queue_changed", this.onQueueChanged);
			frappe.realtime.on("erpnext_todo_queue_changed", this.onQueueChanged);
			frappe.realtime.off("list_update", this.onListUpdate);
			frappe.realtime.on("list_update", this.onListUpdate);
			frappe.realtime.emit("doctype_subscribe", "ToDo");
			if (!this.connectBound) {
				this.connectBound = true;
				socket.on("connect", () => subscribe());
			}
			return true;
		};
		if (!subscribe()) {
			const timer = setInterval(() => {
				if (subscribe()) {
					clearInterval(timer);
				}
			}, 500);
		}
		document.addEventListener("visibilitychange", () => {
			if (document.visibilityState === "visible") {
				this.scheduleRefresh();
			}
		});
	},

	onKeydown(event) {
		if (event.key !== "Escape" || this.phase === "closed" || this.phase === "closing") {
			return;
		}
		if (document.querySelector(".modal.show, .modal.in")) {
			return;
		}
		this.closeManual();
	},

	onBarClick(event) {
		if (event.target.closest(".todo-launcher__sound")) {
			this.toggleSound();
			return;
		}
		if (this.phase !== "open") {
			if (this.phase === "closed") {
				this.openPanel();
			}
			return;
		}
		if (event.target.closest(".todo-launcher__icon")) {
			this.showAll();
			return;
		}
		const count = event.target.closest(".todo-launcher__count");
		if (count) {
			this.setPriority(count.dataset.priority);
		}
	},

	openPanel() {
		if (this.phase !== "closed") {
			return;
		}
		const restore = this.returnToTask && this.expanded;
		const restoreName = this.expanded;
		this.returnToTask = false;
		if (!restore) {
			this.expanded = null;
			this.detail = null;
			this.solo = false;
			this.rows = [];
			this.scrollTop = 0;
		}
		const token = this.beginPhase("widening");
		this.open = false;
		this.loadCounts();
		this.syncBarHeight();
		const start = Math.ceil(this.root.getBoundingClientRect().width);
		this.root.classList.add("is-wide");
		this.root.style.transition = "none";
		this.root.style.width = `${start}px`;
		this.root.offsetWidth;
		this.root.style.transition = "";
		const target = Math.max(start, Math.min(360, window.innerWidth - 32));
		this.root.style.width = `${target}px`;
		this.layoutCounts(true, true);
		if (restore) {
			this.loadAndReveal(restoreName);
		} else {
			this.loadFirstPage();
		}
		this.afterTransition(this.root, "width", token, () => {
			this.phase = "open";
			this.open = true;
			this.root.classList.add("is-open");
			this.tab.setAttribute("aria-expanded", "true");
			this.renderTab();
			this.growPanel();
		});
	},

	closeManual() {
		this.animateShut(false);
	},

	openReference(referenceType, referenceName) {
		this.returnToTask = true;
		this.animateShut(true);
		frappe.set_route("Form", referenceType, referenceName);
	},

	showAll() {
		if (this.phase !== "open") {
			return;
		}
		if (!this.priority && !this.solo) {
			return;
		}
		this.priority = null;
		this.expanded = null;
		this.detail = null;
		this.solo = false;
		this.scrollTop = 0;
		this.error = "";
		this.renderTab();
		this.loadFirstPage();
	},

	animateShut(keepMemory) {
		if (this.phase === "closed" || this.phase === "closing") {
			return;
		}
		const token = this.beginPhase("closing");
		this.open = false;
		if (!keepMemory) {
			this.returnToTask = false;
			this.expanded = null;
			this.priority = null;
			this.solo = false;
			this.scrollTop = 0;
			this.error = "";
			this.statusPending = null;
		}
		this.renderTab();
		const current = this.panel.getBoundingClientRect().height;
		const afterHeight = () => {
			this.root.classList.remove("is-open");
			this.tab.setAttribute("aria-expanded", "false");
			this.collapseWidth(token, () => {
				this.releaseHeavy();
				this.panel.style.height = "0px";
				this.phase = "closed";
			});
		};
		if (current < 1) {
			afterHeight();
			return;
		}
		this.panel.style.height = `${current}px`;
		this.panel.offsetHeight;
		this.panel.style.height = "0px";
		this.afterTransition(this.panel, "height", token, afterHeight);
	},

	collapseWidth(token, done) {
		if (token !== this.motionToken) {
			return;
		}
		const counts = [...this.countsEl.children];
		const openWidths = counts.map((count) => Math.ceil(count.getBoundingClientRect().width) || 40);
		const wide = this.root.style.width;
		this.root.style.transition = "none";
		for (const count of counts) {
			count.style.transition = "none";
			count.style.padding = "0px";
			count.style.width = "28px";
		}
		this.root.style.width = "max-content";
		const collapsed = Math.ceil(this.tab.getBoundingClientRect().width);
		this.root.style.width = wide;
		counts.forEach((count, index) => {
			const value = this.counts[count.dataset.priority] || 0;
			count.classList.remove("is-capped");
			count.textContent = String(value);
			count.style.padding = "0 10px";
			count.style.width = `${openWidths[index]}px`;
		});
		this.root.offsetWidth;
		this.root.style.transition = "";
		for (const count of counts) {
			count.style.transition = "";
		}
		this.root.offsetWidth;
		this.root.style.width = `${collapsed}px`;
		counts.forEach((count) => {
			const value = this.counts[count.dataset.priority] || 0;
			const capped = value > 9;
			count.classList.toggle("is-capped", capped);
			count.textContent = capped ? "9+" : String(value);
			count.style.padding = "0px";
			count.style.width = "28px";
		});
		this.afterTransition(this.root, "width", token, () => {
			this.root.style.width = "";
			this.root.classList.remove("is-wide");
			this.layoutCounts(false, false);
			done();
		});
	},

	growPanel() {
		if (this.phase !== "open") {
			return;
		}
		const next = this.panelHeight();
		this.panel.style.height = "0px";
		this.panel.offsetHeight;
		this.panel.style.height = `${next}px`;
	},

	syncPanelHeight() {
		if (this.phase !== "open" || window.innerWidth <= 768) {
			return;
		}
		const next = this.panelHeight();
		if (this.panel.style.height !== `${next}px`) {
			this.panel.style.height = `${next}px`;
		}
	},

	panelHeight() {
		const bar = this.tab.getBoundingClientRect().height || 48;
		if (window.innerWidth <= 768) {
			return Math.max(120, window.innerHeight - bar);
		}
		const header = this.sheet.querySelector(".todo-launcher__header");
		const headerHeight = header ? header.offsetHeight : 0;
		const errorHeight = this.errorEl.hidden ? 0 : this.errorEl.offsetHeight;
		let bodyHeight = 0;
		for (const child of this.body.children) {
			bodyHeight += child.offsetHeight;
		}
		bodyHeight = Math.min(350, Math.max(130, bodyHeight));
		return headerHeight + errorHeight + bodyHeight;
	},

	syncBarHeight() {
		const height = this.tab.getBoundingClientRect().height;
		if (height) {
			this.root.style.setProperty("--bar-height", `${Math.ceil(height)}px`);
		}
	},

	beginPhase(phase) {
		this.phase = phase;
		this.motionToken += 1;
		return this.motionToken;
	},

	afterTransition(element, property, token, done) {
		let finished = false;
		const finish = () => {
			if (finished) {
				return;
			}
			finished = true;
			element.removeEventListener("transitionend", onEnd);
			if (token !== this.motionToken) {
				return;
			}
			done();
		};
		const onEnd = (event) => {
			if (event.target === element && event.propertyName === property) {
				finish();
			}
		};
		element.addEventListener("transitionend", onEnd);
		const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
		const wait = reduce ? 0 : property === "width" ? 280 : 320;
		setTimeout(finish, wait);
	},

	layoutCounts(exact, animate) {
		const counts = [...this.countsEl.children];
		if (!counts.length) {
			return;
		}
		const currents = counts.map((count) => count.getBoundingClientRect().width || 28);
		for (const count of counts) {
			const value = this.counts[count.dataset.priority] || 0;
			const capped = !exact && value > 9;
			count.classList.toggle("is-capped", capped);
			count.textContent = capped ? "9+" : String(value);
			count.style.transition = "none";
			count.style.padding = exact ? "0 10px" : "0px";
			count.style.width = "auto";
		}
		const targets = counts.map((count) =>
			exact ? Math.max(40, Math.ceil(count.scrollWidth)) : 28
		);
		if (!animate) {
			counts.forEach((count, index) => {
				count.style.width = `${targets[index]}px`;
			});
			this.root.offsetWidth;
			for (const count of counts) {
				count.style.transition = "";
			}
			return;
		}
		counts.forEach((count, index) => {
			count.style.padding = exact ? "0px" : "0 10px";
			count.style.width = `${Math.ceil(currents[index])}px`;
		});
		this.root.offsetWidth;
		for (const count of counts) {
			count.style.transition = "";
		}
		this.root.offsetWidth;
		counts.forEach((count, index) => {
			count.style.padding = exact ? "0 10px" : "0px";
			count.style.width = `${targets[index]}px`;
		});
	},

	releaseHeavy() {
		this.listToken += 1;
		this.detailToken += 1;
		this.rows = [];
		this.detail = null;
		this.hasMore = false;
		this.loading = false;
		if (this.body) {
			this.body.replaceChildren();
		}
	},

	scheduleRefresh() {
		clearTimeout(this.refreshTimer);
		this.refreshTimer = setTimeout(() => this.refreshFromEvent(), 300);
	},

	refreshFromEvent() {
		this.loadCounts();
		if (this.phase !== "open" && this.phase !== "widening" && !this.open) {
			return;
		}
		if (this.solo && this.expanded) {
			this.fetchDetail(this.expanded);
			return;
		}
		this.reloadOpenList();
	},

	loadCounts() {
		const token = ++this.countToken;
		this.call("get_queue_counts")
			.then((message) => {
				if (token !== this.countToken || !message) {
					return;
				}
				const next = {
					High: Number(message.High) || 0,
					Medium: Number(message.Medium) || 0,
					Low: Number(message.Low) || 0,
				};
				const previous = this.countsReady ? { ...this.counts } : null;
				this.counts = next;
				this.countsReady = true;
				this.hasOverdue = Boolean(message.has_overdue);
				this.renderTab();
				this.announceCounts(previous, next);
			})
			.catch(() => {});
	},

	announceCounts(previous, next) {
		const priorities = PRIORITIES.filter((priority) => {
			const value = next[priority] || 0;
			if (!previous) {
				return value > 0;
			}
			return value > (previous[priority] || 0);
		});
		if (!priorities.length) {
			return;
		}
		this.playBell();
		this.blink(priorities);
	},

	blink(priorities) {
		if (!this.countsEl) {
			return;
		}
		for (const priority of priorities) {
			const count = this.countsEl.querySelector(`[data-priority="${priority}"]`);
			if (!count) {
				continue;
			}
			count.classList.remove("is-attention");
			void count.offsetWidth;
			count.classList.add("is-attention");
		}
	},

	readSoundMuted() {
		try {
			return localStorage.getItem("erpnext_todo_sound_muted") === "1";
		} catch (error) {
			return false;
		}
	},

	bindSoundSync() {
		window.addEventListener("storage", (event) => {
			if (event.key !== "erpnext_todo_sound_muted") {
				return;
			}
			this.soundMuted = event.newValue === "1";
			this.pendingBell = false;
			this.renderSound();
		});
	},

	toggleSound() {
		this.soundMuted = !this.soundMuted;
		this.pendingBell = false;
		try {
			localStorage.setItem("erpnext_todo_sound_muted", this.soundMuted ? "1" : "0");
		} catch (error) {
			// The choice still applies until the page is closed.
		}
		this.renderSound();
	},

	renderSound() {
		if (!this.soundBtn) {
			return;
		}
		const speaker = `<svg viewBox="0 0 16 16" aria-hidden="true"><path fill="currentColor" d="M2.4 6.1h2.1L7.8 3.5v9L4.5 9.9H2.4A.7.7 0 0 1 1.7 9.2V6.8a.7.7 0 0 1 .7-.7z"/><path fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" d="M9.7 6.2a2.4 2.4 0 0 1 0 3.6M11.3 4.7a4.4 4.4 0 0 1 0 6.6"/></svg>`;
		const muted = `<svg viewBox="0 0 16 16" aria-hidden="true"><path fill="currentColor" d="M2.2 6.1h2L7.2 3.5v9L4.2 9.9H2.2a.7.7 0 0 1-.7-.7V6.8a.7.7 0 0 1 .7-.7z"/><path fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" d="M10 6.1 13.4 9.9M13.4 6.1 10 9.9"/></svg>`;
		this.soundBtn.innerHTML = this.soundMuted ? muted : speaker;
		this.soundBtn.classList.toggle("is-muted", this.soundMuted);
		this.soundBtn.setAttribute("aria-pressed", this.soundMuted ? "true" : "false");
		this.soundBtn.setAttribute("aria-label", this.soundMuted ? __("Unmute") : __("Mute"));
	},

	playBell() {
		if (this.soundMuted) {
			this.pendingBell = false;
			return;
		}
		const AudioContext = window.AudioContext || window.webkitAudioContext;
		if (!AudioContext) {
			return;
		}
		if (!this.audio) {
			this.audio = new AudioContext();
		}
		const play = () => {
			if (this.soundMuted) {
				this.pendingBell = false;
				return;
			}
			this.pendingBell = false;
			this.bellPlayed = true;
			this.strikeBell();
		};
		if (this.audio.state === "suspended") {
			this.pendingBell = true;
			this.audio.resume().then(() => {
				if (this.pendingBell && this.audio.state === "running") {
					play();
				}
			});
			if (!this.bellUnlock) {
				this.bellUnlock = () => {
					if (!this.pendingBell || !this.audio) {
						return;
					}
					this.audio.resume().then(() => {
						if (this.pendingBell) {
							play();
						}
					});
				};
				document.addEventListener("pointerdown", this.bellUnlock, { once: true });
			}
			return;
		}
		play();
	},

	strikeBell() {
		const ctx = this.audio;
		if (!ctx) {
			return;
		}
		const now = ctx.currentTime;
		[880, 1320].forEach((frequency, index) => {
			const osc = ctx.createOscillator();
			const gain = ctx.createGain();
			osc.type = "sine";
			osc.frequency.value = frequency;
			const start = now + index * 0.11;
			gain.gain.setValueAtTime(0.0001, start);
			gain.gain.exponentialRampToValueAtTime(0.12, start + 0.015);
			gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.7);
			osc.connect(gain);
			gain.connect(ctx.destination);
			osc.start(start);
			osc.stop(start + 0.72);
		});
	},

	setPriority(priority) {
		if (this.phase !== "open") {
			return;
		}
		this.priority = this.priority === priority ? null : priority;
		this.expanded = null;
		this.detail = null;
		this.solo = false;
		this.scrollTop = 0;
		this.error = "";
		this.renderTab();
		this.loadFirstPage();
	},

	rowsFor(priority) {
		if (!priority) {
			return this.queue.slice();
		}
		return this.queue.filter((row) => row.priority === priority);
	},

	rememberQueue(rows, priority) {
		if (!priority) {
			this.queue = rows.slice();
		} else {
			const rest = this.queue.filter((row) => row.priority !== priority);
			this.queue = rest.concat(rows);
		}
		this.queueReady = true;
	},

	sameRows(left, right) {
		if (left.length !== right.length) {
			return false;
		}
		return left.every((row, index) => row.name === right[index].name);
	},

	loadFirstPage() {
		const token = ++this.listToken;
		const priority = this.priority;
		this.hasMore = false;
		if (this.queueReady) {
			this.loading = false;
			this.rows = this.rowsFor(priority);
			this.renderBody();
		} else {
			this.loading = true;
			this.rows = [];
			this.renderBody();
		}
		this.fetchPage(0)
			.then((rows) => {
				if (token !== this.listToken || priority !== this.priority) {
					return;
				}
				this.loading = false;
				this.rememberQueue(rows, priority);
				const next = this.rowsFor(this.priority);
				this.hasMore = rows.length === PAGE_SIZE && next.length < MAX_ROWS;
				if (this.sameRows(this.rows, next)) {
					return;
				}
				this.rows = next;
				this.renderBody();
			})
			.catch(() => {
				if (token !== this.listToken) {
					return;
				}
				this.loading = false;
				this.error = __("Could not load the queue");
				this.renderBody();
			});
	},

	loadMore() {
		if (!this.open || this.loading || !this.hasMore || this.rows.length >= MAX_ROWS || this.solo) {
			return;
		}
		const token = this.listToken;
		const start = this.rows.length;
		this.loading = true;
		this.fetchPage(start)
			.then((rows) => {
				if (token !== this.listToken) {
					return;
				}
				this.loading = false;
				this.rows = this.rows.concat(rows).slice(0, MAX_ROWS);
				this.hasMore = rows.length === PAGE_SIZE && this.rows.length < MAX_ROWS;
				this.renderBody();
			})
			.catch(() => {
				if (token !== this.listToken) {
					return;
				}
				this.loading = false;
			});
	},

	loadAndReveal(name) {
		const token = ++this.listToken;
		this.loading = true;
		this.solo = false;
		this.rows = [];
		this.renderBody();
		this.fetchPage(0)
			.then(async (first) => {
				if (token !== this.listToken) {
					return;
				}
				let rows = first;
				if (!rows.some((row) => row.name === name) && rows.length === PAGE_SIZE) {
					const second = await this.fetchPage(PAGE_SIZE);
					if (token !== this.listToken) {
						return;
					}
					rows = rows.concat(second);
				}
				this.loading = false;
				this.rows = rows.slice(0, MAX_ROWS);
				this.hasMore = rows.length === PAGE_SIZE && this.rows.length < MAX_ROWS;
				if (this.rows.some((row) => row.name === name)) {
					this.expanded = name;
					this.solo = false;
					this.renderBody();
					this.fetchDetail(name);
					this.scrollTo(name);
					return;
				}
				this.revealSolo(name, token);
			})
			.catch(() => {
				if (token !== this.listToken) {
					return;
				}
				this.loading = false;
				this.error = __("Could not load the queue");
				this.renderBody();
			});
	},

	revealSolo(name, token) {
		this.call("get_todo_detail", { name })
			.then((detail) => {
				if (token !== this.listToken) {
					return;
				}
				if (!detail || detail.status !== "Open") {
					this.expanded = null;
					this.detail = null;
					this.solo = false;
					this.renderBody();
					return;
				}
				this.expanded = name;
				this.detail = detail;
				this.solo = true;
				this.renderBody();
			})
			.catch(() => {
				if (token !== this.listToken) {
					return;
				}
				this.expanded = null;
				this.solo = false;
				this.renderBody();
			});
	},

	reloadOpenList() {
		const token = ++this.listToken;
		const expanded = this.expanded;
		const scroll = this.scrollTop;
		const starts = this.rows.length > PAGE_SIZE ? [0, PAGE_SIZE] : [0];
		Promise.all(starts.map((start) => this.fetchPage(start)))
			.then((parts) => {
				if (token !== this.listToken) {
					return;
				}
				const fetched = parts.flat().slice(0, MAX_ROWS);
				this.rememberQueue(fetched, this.priority);
				this.rows = this.rowsFor(this.priority);
				const last = parts[parts.length - 1] || [];
				this.hasMore = last.length === PAGE_SIZE && this.rows.length < MAX_ROWS;
				if (expanded && this.rows.some((row) => row.name === expanded)) {
					this.expanded = expanded;
					this.fetchDetail(expanded);
				} else {
					this.expanded = null;
					this.detail = null;
				}
				this.renderBody();
				this.body.scrollTop = scroll;
			})
			.catch(() => {
				if (token !== this.listToken) {
					return;
				}
			});
	},

	fetchPage(start) {
		const args = { start };
		if (this.priority) {
			args.priority = this.priority;
		}
		return this.call("get_queue", args).then((rows) => rows || []);
	},

	fetchDetail(name) {
		const token = ++this.detailToken;
		this.call("get_todo_detail", { name })
			.then((detail) => {
				if (token !== this.detailToken || this.expanded !== name) {
					return;
				}
				if (!detail || detail.status !== "Open") {
					this.rows = this.rows.filter((row) => row.name !== name);
					this.queue = this.queue.filter((row) => row.name !== name);
					this.expanded = null;
					this.detail = null;
					this.solo = false;
					this.renderBody();
					this.loadCounts();
					return;
				}
				this.detail = detail;
				this.renderBody();
			})
			.catch(() => {
				if (token !== this.detailToken || this.expanded !== name) {
					return;
				}
				this.error = __("Could not load the to-do");
				this.renderBody();
			});
	},

	toggleRow(name) {
		if (this.expanded === name && !this.solo) {
			this.expanded = null;
			this.detail = null;
			this.detailToken += 1;
			this.renderBody();
			return;
		}
		this.solo = false;
		this.expanded = name;
		this.detail = null;
		this.error = "";
		this.renderBody();
		this.fetchDetail(name);
	},

	showQueue() {
		this.solo = false;
		this.expanded = null;
		this.detail = null;
		this.detailToken += 1;
		if (!this.rows.length) {
			this.loadFirstPage();
			return;
		}
		this.renderBody();
	},

	changeStatus(name, status) {
		if (this.statusPending) {
			return;
		}
		this.statusPending = name;
		this.error = "";
		this.renderBody();
		this.call("set_todo_status", { name, status })
			.then(() => {
				if (this.statusPending !== name) {
					return;
				}
				this.statusPending = null;
				if (status === "Closed" || status === "Cancelled") {
					this.rows = this.rows.filter((row) => row.name !== name);
					this.queue = this.queue.filter((row) => row.name !== name);
					if (this.expanded === name) {
						this.expanded = null;
						this.detail = null;
						this.solo = false;
					}
				} else if (this.detail && this.detail.name === name) {
					this.detail.status = status;
				}
				this.renderBody();
				this.loadCounts();
			})
			.catch(() => {
				this.statusPending = null;
				this.error = __("Could not update status");
				this.renderBody();
			});
	},

	openFullList() {
		const options = {
			status: "Open",
			allocated_to: frappe.session.user,
		};
		if (this.priority) {
			options.priority = this.priority;
		}
		frappe.route_options = options;
		frappe.set_route("List", "ToDo");
	},

	call(method, args) {
		return frappe.xcall(`${TODO_QUEUE}.${method}`, args);
	},

	renderTab() {
		if (!this.countsEl) {
			return;
		}
		for (const priority of PRIORITIES) {
			let count = this.countsEl.querySelector(`[data-priority="${priority}"]`);
			if (!count) {
				count = document.createElement("button");
				count.type = "button";
				count.dataset.priority = priority;
				count.className = `todo-launcher__count todo-launcher__count--${priority.toLowerCase()}`;
				this.countsEl.appendChild(count);
			}
			const value = this.counts[priority] || 0;
			const selected = this.phase === "open" && this.priority === priority;
			count.title = `${__(priority)} ${value}`;
			count.setAttribute("aria-label", `${__(priority)} ${value}`);
			count.classList.toggle("is-active", selected);
			count.setAttribute("aria-pressed", selected ? "true" : "false");
		}
		const showAll = this.phase === "open" && !this.priority;
		this.iconBtn.classList.toggle("is-active", showAll);
		this.iconBtn.setAttribute("aria-pressed", showAll ? "true" : "false");
		this.overdueEl.hidden = !this.hasOverdue;
		if (this.phase === "closing") {
			return;
		}
		if (this.phase === "closed") {
			this.layoutCounts(false, false);
			return;
		}
		const stale = [...this.countsEl.children].some((count) => {
			const value = String(this.counts[count.dataset.priority] || 0);
			return count.textContent !== value;
		});
		if (stale) {
			this.layoutCounts(true, true);
		}
	},

	renderBody() {
		const scroll = this.scrollTop;
		this.errorEl.hidden = !this.error;
		this.errorEl.textContent = this.error || "";
		this.body.replaceChildren();
		if (this.solo && this.detail) {
			this.body.appendChild(this.soloCard(this.detail));
			this.syncPanelHeight();
			return;
		}
		if (!this.rows.length && !this.loading) {
			const empty = document.createElement("p");
			empty.className = "todo-launcher__empty";
			empty.textContent = __("No open to-dos");
			this.body.appendChild(empty);
			this.syncPanelHeight();
			return;
		}
		for (const row of this.rows) {
			this.body.appendChild(this.rowCard(row));
		}
		if (this.loading) {
			this.body.appendChild(this.loadingLine());
		}
		if (this.rows.length >= MAX_ROWS) {
			const more = document.createElement("button");
			more.type = "button";
			more.className = "todo-launcher__list-link";
			more.textContent = __("Open list");
			more.addEventListener("click", () => this.openFullList());
			this.body.appendChild(more);
		} else if (this.hasMore) {
			const sentinel = document.createElement("div");
			sentinel.className = "todo-launcher__more";
			this.body.appendChild(sentinel);
			this.observer.observe(sentinel);
		}
		this.body.scrollTop = scroll;
		this.syncPanelHeight();
	},

	rowCard(row) {
		const article = document.createElement("article");
		article.className = "todo-launcher__row";
		article.dataset.name = row.name;
		if (this.expanded === row.name) {
			article.classList.add("is-open");
		}
		const summary = document.createElement("button");
		summary.type = "button";
		summary.className = "todo-launcher__summary";
		summary.append(
			this.dot(row.priority),
			this.summaryText(row),
			this.dateEl(row.date)
		);
		summary.addEventListener("click", () => this.toggleRow(row.name));
		article.appendChild(summary);
		if (this.expanded === row.name) {
			article.appendChild(this.detailEl(row));
		}
		return article;
	},

	soloCard(detail) {
		const wrap = document.createElement("article");
		wrap.className = "todo-launcher__row is-open";
		const back = document.createElement("button");
		back.type = "button";
		back.className = "todo-launcher__back";
		back.textContent = __("Queue");
		back.addEventListener("click", () => this.showQueue());
		wrap.append(back, this.detailEl(detail));
		return wrap;
	},

	summaryText(row) {
		const text = document.createElement("span");
		text.className = "todo-launcher__preview";
		text.textContent = row.preview || __("ToDo");
		return text;
	},

	dateEl(value) {
		const date = document.createElement("span");
		date.className = "todo-launcher__date";
		if (!value) {
			return date;
		}
		date.textContent = frappe.datetime.str_to_user(value);
		if (value < frappe.datetime.get_today()) {
			date.classList.add("is-overdue");
		}
		return date;
	},

	loadingLine() {
		const loading = document.createElement("p");
		loading.className = "todo-launcher__loading";
		const label = document.createElement("span");
		label.textContent = __("Loading");
		const dots = document.createElement("span");
		dots.className = "todo-launcher__dots";
		dots.setAttribute("aria-hidden", "true");
		loading.append(label, dots);
		return loading;
	},

	dot(priority) {
		const dot = document.createElement("span");
		dot.className = `todo-launcher__dot todo-launcher__dot--${(priority || "medium").toLowerCase()}`;
		dot.title = __(priority || "");
		return dot;
	},

	detailEl(row) {
		const detail = document.createElement("div");
		detail.className = "todo-launcher__detail";
		const loaded = this.detail && this.detail.name === row.name ? this.detail : null;
		if (!loaded) {
			detail.appendChild(this.loadingLine());
			return detail;
		}
		const text = document.createElement("div");
		text.className = "todo-launcher__html";
		text.innerHTML = loaded.description_html || "";
		if (!loaded.description_html) {
			const empty = document.createElement("p");
			empty.className = "todo-launcher__empty";
			empty.textContent = row.preview || __("ToDo");
			text.appendChild(empty);
		}
		detail.appendChild(text);
		if (loaded.reference_type && loaded.reference_name) {
			const link = document.createElement("button");
			link.type = "button";
			link.className = "todo-launcher__reference";
			link.textContent = `${__(loaded.reference_type)} ${loaded.reference_name}`;
			link.addEventListener("click", () =>
				this.openReference(loaded.reference_type, loaded.reference_name)
			);
			detail.appendChild(link);
		}
		detail.appendChild(this.statusControl(loaded));
		return detail;
	},

	statusControl(detail) {
		const row = document.createElement("div");
		row.className = "todo-launcher__status-row";
		const select = document.createElement("select");
		select.className = "todo-launcher__status";
		select.setAttribute("aria-label", __("Status"));
		for (const status of STATUSES) {
			const option = document.createElement("option");
			option.value = status;
			option.textContent = __(status);
			select.appendChild(option);
		}
		select.value = detail.status || "Open";
		select.disabled = this.statusPending === detail.name;
		select.addEventListener("change", () => this.changeStatus(detail.name, select.value));
		const open = document.createElement("button");
		open.type = "button";
		open.className = "todo-launcher__open-doc";
		open.innerHTML = frappe.utils.icon("arrow-up-right", "sm");
		open.title = "открыть туду";
		open.setAttribute("aria-label", "открыть туду");
		open.addEventListener("click", () => this.openReference("ToDo", detail.name));
		row.append(select, open);
		return row;
	},

	scrollTo(name) {
		const row = this.body.querySelector(`[data-name="${CSS.escape(name)}"]`);
		if (row) {
			row.scrollIntoView({ block: "nearest" });
			this.scrollTop = this.body.scrollTop;
		}
	},
};

$(document).on("app_ready", () => {
	erpnext_todo.launcher.start();
});
