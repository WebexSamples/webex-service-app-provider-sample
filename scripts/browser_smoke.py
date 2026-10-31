"""Optional Playwright smoke test. No real Webex data or configured secrets are used."""
import os
from pathlib import Path
import secrets
import socket
import subprocess
import tempfile

from playwright.sync_api import sync_playwright, expect


ROOT = Path(__file__).resolve().parent.parent
ARTIFACTS = ROOT / "artifacts"


def first_run_smoke(browser):
    with tempfile.TemporaryDirectory(prefix="service-app-first-run-") as directory:
        with socket.socket() as listener:
            listener.bind(("127.0.0.1", 0))
            port = listener.getsockname()[1]
        command = ["node", "server.mjs", "--port", str(port), "--data-dir", directory]
        environment = {"PATH": os.environ["PATH"]}
        password, client_secret = secrets.token_urlsafe(24), secrets.token_urlsafe(24)
        server = None
        context = browser.new_context(viewport={"width": 1440, "height": 1100})
        try:
            server = subprocess.Popen(command, cwd=ROOT, env=environment, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
            assert "live mode" in server.stdout.readline(), "No-environment server did not start"
            private_link = server.stdout.readline().strip().split(": ", 1)[1]
            page = context.new_page()
            page.goto(private_link)
            expect(page.get_by_role("heading", name="Set up your provider account")).to_be_visible()
            assert "#setup=" not in page.url, "Setup code remained in browser history"
            page.get_by_label("Email address", exact=True).fill("owner@example.test")
            page.get_by_label("Password", exact=True).fill(password)
            page.get_by_role("button", name="Create provider account", exact=True).click()
            expect(page.get_by_role("heading", name="Webex registrations", exact=True)).to_be_visible()
            for choice in ["Service App only", "Integration only", "Service App and Integration", "Neither yet"]:
                page.get_by_role("radio", name=choice, exact=True).check()
                expect(page.get_by_role("radio", name=choice, exact=True)).to_be_checked()
            for width in [320, 390]:
                page.set_viewport_size({"width": width, "height": 844})
                assert page.evaluate("document.documentElement.scrollWidth <= innerWidth"), "Provider setup overflows on mobile"
            page.screenshot(path=str(ARTIFACTS / "provider-setup-mobile.png"), full_page=True)
            page.set_viewport_size({"width": 1440, "height": 1100})
            page.screenshot(path=str(ARTIFACTS / "provider-setup.png"))
            for label, value in [
                ("Service App ID", "sample-service-app"), ("Service App client ID", "sample-service-client"),
                ("Service App client secret", client_secret), ("Provider Integration client ID", "sample-provider-client"),
                ("Provider Integration client secret", client_secret), ("Customer Integration client ID", "sample-customer-client"),
                ("Customer Integration client secret", client_secret),
            ]:
                page.get_by_label(label, exact=True).fill(value)
            page.get_by_role("button", name="Save available registrations", exact=True).click()
            expect(page.get_by_role("status")).to_contain_text("saved securely")
            page.get_by_label("Customer email address", exact=True).fill("customer@example.test")
            page.get_by_label("Customer password", exact=True).fill(password)
            page.get_by_role("button", name="Create customer sign-in", exact=True).click()
            expect(page.get_by_role("status")).to_contain_text("Customer sign-in created")
            assert client_secret.encode() not in Path(directory, "live.sqlite").read_bytes(), "Registration secret stored in plaintext"
            assert Path(directory, "master.key").stat().st_mode & 0o777 == 0o600
            context.close()
            server.terminate()
            server.wait(timeout=10)
            server = subprocess.Popen(command, cwd=ROOT, env=environment, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
            assert "live mode" in server.stdout.readline(), "Saved configuration did not restart"
            context = browser.new_context(viewport={"width": 1440, "height": 1100})
            page = context.new_page()
            page.goto(f"http://localhost:{port}")
            expect(page.get_by_role("heading", name="Welcome back", exact=True)).to_be_visible()
            page.get_by_label("Email address", exact=True).fill("owner@example.test")
            page.get_by_label("Password", exact=True).fill(password)
            page.get_by_label("Password", exact=True).press("Enter")
            page.get_by_role("button", name="Edit registration details", exact=True).click()
            expect(page.get_by_label("Service App ID", exact=True)).to_have_value("sample-service-app")
            expect(page.get_by_label("Service App client secret", exact=True)).to_have_value("")
            expect(page.get_by_label("Service App client secret", exact=True)).to_have_attribute("placeholder", "Saved · leave blank to keep")
        finally:
            context.close()
            if server:
                server.terminate()
                try:
                    server.wait(timeout=10)
                except subprocess.TimeoutExpired:
                    server.kill()
                    server.wait(timeout=5)


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
                first_run_smoke(browser)
                errors = []
                external_requests = []

                def observe(page):
                    page.on("pageerror", lambda error: errors.append(str(error)))
                    page.on("console", lambda message: errors.append(message.text) if message.type == "error" else None)
                    page.on("request", lambda request: external_requests.append(request.url) if not request.url.startswith(base_url + "/") else None)

                def check_mobile(page, name):
                    for width in [320, 390]:
                        page.set_viewport_size({"width": width, "height": 844})
                        assert page.evaluate("document.documentElement.scrollWidth <= window.innerWidth"), f"{name} overflows at {width}px"
                    page.evaluate("window.scrollTo(0, 0)")
                    page.screenshot(path=str(ARTIFACTS / f"{name}-mobile.png"), full_page=True)
                    page.set_viewport_size({"width": 1440, "height": 1100})

                def login(email):
                    context = browser.new_context(viewport={"width": 1440, "height": 1100})
                    page = context.new_page()
                    observe(page)
                    page.goto(base_url)
                    page.wait_for_load_state("networkidle")
                    page.get_by_label("Email address").fill(email)
                    page.get_by_label("Password", exact=True).fill(password)
                    page.get_by_label("Password", exact=True).press("Enter")
                    expect(page.get_by_role("button", name="Sign out", exact=True)).to_be_visible()
                    return context, page

                # Inspect the rendered login page before operating the authenticated views.
                landing = browser.new_page(viewport={"width": 1440, "height": 1000})
                observe(landing)
                landing.goto(base_url)
                landing.wait_for_load_state("networkidle")
                expect(landing.get_by_role("heading", name="Welcome back")).to_be_visible()
                landing.screenshot(path=str(ARTIFACTS / "login.png"), full_page=True)
                check_mobile(landing, "login")
                landing.get_by_role("button", name="Sign in →", exact=True).click()
                assert landing.get_by_label("Email address").evaluate("input => !input.validity.valid"), "Native form validation missing"
                landing.close()

                provider_context, provider = login("provider@example.test")
                assert provider.evaluate("customElements.get('mdc-button') && document.querySelector('mdc-button').shadowRoot"), "Momentum buttons did not hydrate"
                provider.evaluate("document.fonts.ready")
                assert provider.evaluate("document.fonts.check('15px Momentum')"), "Local Momentum font did not load"
                provider.get_by_role("button", name="Connect demo Integration", exact=True).press("Enter")
                expect(provider.get_by_text("Demo provider Integration connected.", exact=True)).to_be_visible()
                provider.get_by_role("button", name="Authorize Summit Outfitters Webex", exact=True).press("Space")
                expect(provider.get_by_role("button", name="Deauthorize Summit Outfitters Webex", exact=True)).to_be_visible()

                customer_context, customer = login("summit@example.test")
                customer.get_by_label("Fixture authority").select_option("member")
                customer.get_by_role("button", name="Verify fixture identity", exact=True).click()
                expect(customer.get_by_role("alert")).to_contain_text("Full Administrator")
                customer.get_by_label("Fixture organization").select_option("demo-summit")
                customer.get_by_label("Fixture authority").select_option("admin")
                customer.get_by_role("button", name="Verify fixture identity", exact=True).click()
                expect(customer.get_by_role("heading", name="Confirm this organization link")).to_be_visible()
                check_mobile(customer, "customer-confirmation")
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
                check_mobile(provider, "provider")

                check_mobile(customer, "customer")

                customer.get_by_text("Disconnect organization", exact=True).click()
                expect(customer.get_by_role("heading", name="Disconnect this organization?", exact=True)).to_be_visible()
                expect(customer.get_by_role("heading", name="Organization directory", exact=True)).to_be_visible()
                customer.get_by_role("button", name="Confirm disconnect", exact=True).click()
                expect(customer.get_by_role("heading", name="Organization directory", exact=True)).to_have_count(0)
                customer.get_by_role("button", name="Verify fixture identity", exact=True).click()
                customer.get_by_role("button", name="Confirm link and activate Service App", exact=True).click()
                expect(customer.get_by_role("heading", name="Organization directory", exact=True)).to_be_visible()

                provider.get_by_role("button", name="Deauthorize Summit Outfitters Webex", exact=True).click()
                customer.get_by_role("button", name="Refresh status", exact=True).click()
                expect(customer.get_by_text("Disconnected", exact=True)).to_be_visible()
                expect(customer.get_by_role("heading", name="Organization directory", exact=True)).to_have_count(0)
                # Chromium logs the member denial and duplicate-claim denial exercised above.
                expected_denials = {
                    "Failed to load resource: the server responded with a status of 403 (Forbidden)",
                    "Failed to load resource: the server responded with a status of 409 (Conflict)",
                }
                unexpected_errors = [error for error in errors if error not in expected_denials]
                assert not unexpected_errors, f"Browser errors occurred: {unexpected_errors}"
                assert not external_requests, "The UI made requests outside its own origin"
                for context in [provider_context, customer_context, other_context]:
                    context.close()
                browser.close()
            print("Browser smoke passed: no-env first launch, setup choices, encrypted credentials across restart, customer accounts, Momentum assets, keyboard controls, role isolation, explicit linking, pagination, claim conflict, inline disconnect/reconnect, deauthorization, and 320/390px layouts.")
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
