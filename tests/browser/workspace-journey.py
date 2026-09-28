"""Real Chromium journey against a compiled UI/API and an opted-in local fixture.

No browser or API requests are mocked. External destinations are blocked. Tokens
are read from a temporary 0600 fixture file and never copied to reports.
"""
import json
import os
import pathlib
import re
import shutil
import time
from urllib.parse import urlparse
from playwright.sync_api import sync_playwright, expect

base = os.environ.get("FORGE_BROWSER_URL", "http://localhost:5173")
if urlparse(base).hostname not in ("localhost", "127.0.0.1"):
    raise RuntimeError("Browser journeys accept local disposable servers only")
fixture_path = os.environ["FORGE_BROWSER_FIXTURE_PATH"]
fixture = json.loads(pathlib.Path(fixture_path).read_text())
output = pathlib.Path(os.environ.get("FORGE_BROWSER_REPORT_DIR", "tests/reports/browser"))
output.mkdir(parents=True, exist_ok=True)
checks = []
started = time.monotonic()


def record(name, since):
    checks.append({"testId": name, "passed": True, "durationMs": round((time.monotonic() - since) * 1000)})


with sync_playwright() as playwright:
    browser = playwright.chromium.launch(
        executable_path=os.environ.get("FORGE_CHROME_PATH") or shutil.which("google-chrome") or shutil.which("chromium"),
        headless=True,
    )
    try:
        def session(identity):
            context = browser.new_context(viewport={"width": 1440, "height": 1100})
            context.add_cookies([{"name": "forge_session", "value": identity["token"],
                "domain": urlparse(base).hostname, "path": "/", "httpOnly": True, "secure": False, "sameSite": "Lax"}])
            context.route("**/*", lambda route: route.continue_() if urlparse(route.request.url).hostname in
                ("localhost", "127.0.0.1") else route.abort())
            page = context.new_page()
            page.set_default_timeout(15000)
            page.goto(base + "/dashboard", wait_until="domcontentloaded")
            return context, page

        since = time.monotonic()
        owner_context, owner = session(fixture["owner"])
        owner.get_by_role("button", name="Engineering fixture", exact=True).click()
        panel = owner.get_by_label("Selected workspace", exact=True)
        expect(panel.get_by_role("heading", name="Engineering fixture", exact=True)).to_be_visible()
        expect(panel.get_by_label("Workspace administration", exact=True)).to_be_visible()
        record("workspace.browser.authorized-load", since)

        since = time.monotonic()
        admin = panel.get_by_label("Workspace administration", exact=True)
        admin.get_by_label("Name", exact=True).fill("Engineering browser verified")
        admin.get_by_label("Locale", exact=True).fill("en-IN")
        admin.get_by_label("Time zone", exact=True).fill("Asia/Kolkata")
        admin.get_by_role("button", name="Save settings", exact=True).click()
        expect(panel.get_by_role("heading", name="Engineering browser verified", exact=True)).to_be_visible()
        expect(admin.get_by_label("Time zone", exact=True)).to_have_value(re.compile(r"^Asia/(Kolkata|Calcutta)$"))
        record("workspace.browser.settings", since)

        since = time.monotonic()
        admin.get_by_label("Recipient", exact=True).select_option(fixture["member"]["id"])
        admin.get_by_role("button", name="Invite in app", exact=True).click()
        expect(admin.get_by_role("button", name="Renew for seven days", exact=True)).to_be_visible()
        member_context, member = session(fixture["member"])
        member.get_by_text("Workspace invitation inbox", exact=True).click()
        member.get_by_role("button", name="Accept invitation", exact=True).click()
        member_panel = member.get_by_label("Selected workspace", exact=True)
        expect(member_panel.get_by_role("heading", name="Engineering browser verified", exact=True)).to_be_visible()
        expect(member_panel.get_by_label("Workspace administration", exact=True)).to_have_count(0)
        record("workspace.browser.recipient-invitation", since)

        # A concurrent membership acceptance advanced the workspace version. Reload
        # canonical state before a lifecycle write rather than overwriting it.
        owner.reload(wait_until="domcontentloaded")
        owner.get_by_role("button", name="Engineering browser verified", exact=True).click()
        panel = owner.get_by_label("Selected workspace", exact=True)
        admin = panel.get_by_label("Workspace administration", exact=True)
        since = time.monotonic()
        owner.on("dialog", lambda dialog: dialog.accept())
        admin.get_by_label("Reason", exact=True).fill("Disposable browser archive exercise")
        admin.get_by_role("button", name="Archive workspace", exact=True).click()
        expect(admin.get_by_role("button", name="Restore workspace", exact=True)).to_be_visible()
        expect(admin.get_by_role("button", name="Save settings", exact=True)).to_be_disabled()
        expect(panel.get_by_role("button", name="Create in this workspace", exact=True)).to_have_count(0)
        admin.get_by_label("Reason", exact=True).fill("Restore after browser exercise")
        admin.get_by_role("button", name="Restore workspace", exact=True).click()
        expect(admin.get_by_role("button", name="Archive workspace", exact=True)).to_be_visible()
        expect(admin.get_by_role("button", name="Save settings", exact=True)).to_be_enabled()
        record("workspace.browser.archive-restore", since)

        since = time.monotonic()
        outsider_context, outsider = session(fixture["outsider"])
        expect(outsider.get_by_label("Workspace selection", exact=True)).to_be_visible()
        expect(outsider.get_by_role("button", name="Engineering browser verified", exact=True)).to_have_count(0)
        response = outsider_context.request.get("http://localhost:5000/api/v1/tenant-workspaces/" + fixture["workspace"]["id"])
        if response.status != 404:
            raise AssertionError("Unrelated actor could retrieve another workspace")
        record("workspace.browser.unrelated-actor", since)
        owner.screenshot(path=str(output / "workspace-settings.png"), full_page=True)
        member.screenshot(path=str(output / "workspace-member.png"), full_page=True)
    except Exception as error:
        try:
            owner.screenshot(path=str(output / "workspace-failure.png"), full_page=True)
            (output / "workspace-failure.txt").write_text(owner.locator("body").inner_text()[:12000])
        except Exception:
            pass
        checks.append({"testId": "workspace.browser.journey", "passed": False, "errorType": type(error).__name__})
        # Avoid logging arbitrary DOM/network payloads or fixture secrets.
        raise
    finally:
        browser.close()
        report = {"scope": "Compiled workspace UI/API journey on a disposable database", "commit": os.environ.get("GITHUB_SHA"),
            "checks": checks, "durationMs": round((time.monotonic() - started) * 1000), "productionQualified": False}
        (output / "workspace-browser.json").write_text(json.dumps(report, indent=2))
        print(json.dumps({"passed": sum(item["passed"] for item in checks), "failed": sum(not item["passed"] for item in checks)}))
