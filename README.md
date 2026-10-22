### ERPNext ToDo Advanced

A Desk launcher for the current user's open ToDos. It stays on every Desk page and does not replace the standard ToDo list or its permissions.

The collapsed bar sits at the bottom left. It shows a list icon and three counters, one for each priority: High, Medium, and Low. A count above 9 is shown as `9+` until the bar is opened. If any open ToDo is overdue, the bar shows a single overdue mark.

Opening the bar grows it sideways, then upward, and shows the queue above the counters. The counters then display the exact number. Clicking a counter filters the list by that priority; clicking it again, or clicking the list icon, shows every open ToDo. The list is ordered High, Medium, Low, then by date, with empty dates last. It loads 20 rows at a time, keeps at most 40, and links to the standard ToDo list after that.

A row shows the priority color, a short text, and the due date. Overdue dates are highlighted. Opening a row loads the description, the linked document when there is one, a status select (Open, Closed, Cancelled), and an arrow that opens the ToDo form. Closing or cancelling a ToDo removes it after the server confirms the change.

The panel stays open until it is collapsed with the header button or Escape. Going to a linked document or to the ToDo itself collapses the panel and keeps the filter and the opened task; opening the panel again returns to that task when it is still in the queue. On a narrow screen the open panel fills the page. The collapsed bar stays small.

Counts and the open list update from Desk realtime events. There is no polling. A short bell plays when the widget first loads and finds open ToDos, and when a new ToDo arrives. The speaker on the open bar mutes that sound. The mute choice is stored in the browser and shared by other tabs of the same browser.

The queue only includes ToDos allocated to the logged-in user.

### Installation

Install the app with the [bench](https://github.com/frappe/bench) CLI:

```bash
cd $PATH_TO_YOUR_BENCH
bench get-app https://github.com/evghenin/erpnext_todo.git --branch main
bench --site your-site install-app erpnext_todo
```

### Contributing

This app uses `pre-commit` for code formatting and linting. Please [install pre-commit](https://pre-commit.com/#installation) and enable it for this repository:

```bash
cd apps/erpnext_todo
pre-commit install
```

Pre-commit is configured to use the following tools for checking and formatting your code:

- ruff
- eslint
- prettier
- pyupgrade

### License

MIT
