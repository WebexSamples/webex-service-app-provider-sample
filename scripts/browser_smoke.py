"""Optional Playwright smoke test. No real Webex data or configured secrets are used."""
import os
from pathlib import Path
import secrets
import subprocess
import tempfile

from playwright.sync_api import sync_playwright, expect


ROOT = Path(__file__).resolve().parent.parent
ARTIFACTS = ROOT / "artifacts"


def main():
    ARTIFACTS.mkdir(exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="service-app-browser-") as temporary:
        password = secrets.token_urlsafe(24)
        environment = {
            **os.environ,
            "BROWSER_TEST_PASSWORD": password,
            "DATA_PATH": str(Path(temporary) / "fixture.sqlite"),
        }
        server = subprocess.Popen(
            ["node", "scripts/browser-fixture.mjs"],
            cwd=ROOT, env=environment, text=True,
            stdout=subprocess.PIPE, stderr=subprocess.PIPE,
        )
        try:
            base_url = server.stdout.readline().strip()
            if not base_url.startswith("http://127.0.0.1:"):
                raise RuntimeError("The isolated browser fixture did not start.")
            with sync_playwright() as playwright:
                browser = playwright.chromium.launch(headless=True)
                errors = []

                def login(email):
                    context = browser.new_context(viewport={"width": 1440, "height": 1100})
                    page = context.new_page()
                    page.on("pageerror", lambda error: errors.append(str(error)))
                    page.goto(base_url)
                    page.wait_for_load_state("networkidle")
                    page.get_by_label("Email address").fill(email)
                    page.get_by_label("Password", exact=True).fill(password)
                    page.get_by_role("button", name="Sign in →", exact=True).click()
                    expect(page.get_by_role("button", name="Sign out", exact=True)).to_be_visible()
                    return context, page

                # Inspect the rendered login page before operating the authenticated views.
                landing = browser.new_page(viewport={"width": 1440, "height": 1000})
                landing.goto(base_url)
                landing.wait_for_load_state("networkidle")
                expect(landing.get_by_role("heading", name="Welcome back")).to_be_visible()
                landing.screenshot(path=str(ARTIFACTS / "login.png"), full_page=True)
                landing.close()

                provider_context, provider = login("provider@example.test")
                provider.get_by_role("button", name="Connect demo Integration", exact=True).click()
                expect(provider.get_by_text("Demo provider Integration connected.", exact=True)).to_be_visible()
                provider.get_by_role("button", name="Authorize Summit Outfitters Webex", exact=True).click()
                expect(provider.get_by_role("button", name="Deauthorize Summit Outfitters Webex", exact=True)).to_be_visible()

                customer_context, customer = login("summit@example.test")
                customer.get_by_label("Fixture authority").select_option("member")
                customer.get_by_role("button", name="Verify fixture identity", exact=True).click()
                expect(customer.get_by_role("alert")).to_contain_text("Full Administrator")
                customer.get_by_label("Fixture organization").select_option("demo-summit")
                customer.get_by_label("Fixture authority").select_option("admin")
                customer.get_by_role("button", name="Verify fixture identity", exact=True).click()
                expect(customer.get_by_role("heading", name="Confirm this organization link")).to_be_visible()
                customer.get_by_role("button", name="Confirm link and activate Service App", exact=True).click()
                expect(customer.get_by_role("heading", name="Organization directory", exact=True)).to_be_visible()
                customer.get_by_role("button", name="Refresh directory", exact=True).click()
                expect(customer.locator("tbody tr")).to_have_count(3)
                customer.get_by_role("button", name="Load more members", exact=True).click()
                expect(customer.locator("tbody tr")).to_have_count(6)
                customer.evaluate("window.scrollTo(0, 0)")
                customer.screenshot(path=str(ARTIFACTS / "customer-directory.png"))

                other_context, other = login("northstar@example.test")
                other.get_by_label("Fixture organization").select_option("demo-summit")
                other.get_by_role("button", name="Verify fixture identity", exact=True).click()
                other.get_by_role("button", name="Confirm link and activate Service App", exact=True).click()
                expect(other.get_by_role("alert")).to_contain_text("already linked")
                expect(other.get_by_role("heading", name="Organization directory", exact=True)).to_have_count(0)

                provider.get_by_role("button", name="Refresh status", exact=True).click()
                expect(provider.locator("tbody tr").filter(has_text="Summit Outfitters").get_by_text("Connected", exact=True)).to_be_visible()
                provider.evaluate("window.scrollTo(0, 0)")
                provider.screenshot(path=str(ARTIFACTS / "provider-console.png"))

                customer.set_viewport_size({"width": 390, "height": 844})
                customer.evaluate("window.scrollTo(0, 0)")
                customer.screenshot(path=str(ARTIFACTS / "customer-mobile.png"), full_page=True)
                assert customer.evaluate("document.documentElement.scrollWidth <= window.innerWidth"), "Mobile page overflows horizontally"

                provider.get_by_role("button", name="Deauthorize Summit Outfitters Webex", exact=True).click()
                customer.get_by_role("button", name="Refresh status", exact=True).click()
                expect(customer.get_by_text("Disconnected", exact=True)).to_be_visible()
                expect(customer.get_by_role("heading", name="Organization directory", exact=True)).to_have_count(0)
                assert not errors, "Browser JavaScript errors occurred"
                for context in [provider_context, customer_context, other_context]:
                    context.close()
                browser.close()
            print("Browser smoke passed: separate roles, member denial, explicit linking, pagination, claim conflict, deauthorization, and mobile layout.")
            print("Fixture-only screenshots: artifacts/")
        finally:
            server.terminate()
            try:
                server.wait(timeout=10)
            except subprocess.TimeoutExpired:
                server.kill()
                server.wait(timeout=5)


if __name__ == "__main__":
    main()
