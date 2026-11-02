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
        client_secret = secrets.token_urlsafe(24)
        server = None
        context = browser.new_context(viewport={"width": 1440, "height": 1100})
        try:
            server = subprocess.Popen(command, cwd=ROOT, env=environment, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
            assert "live mode" in server.stdout.readline(), "No-environment server did not start"
            page = context.new_page()
            page.goto(f"http://localhost:{port}")
            expect(page.get_by_label("Experience", exact=True)).to_have_value("provider")
            expect(page.get_by_label("Password", exact=True)).to_have_count(0)
            expect(page.get_by_role("button", name="Sign out", exact=True)).to_have_count(0)
            expect(page.get_by_role("heading", name="Overview", exact=True)).to_be_visible()
            expect(page.get_by_role("heading", name="How customer onboarding works", exact=True)).to_be_visible()
            expect(page.locator(".overview-count")).to_have_text("0 / 2")
            expect(page.locator(".overview-last-read")).to_have_text("No directory read recorded for the current connections.")
            expect(page.get_by_role("table")).to_have_count(0)
            expect(page.get_by_label("Service App client ID", exact=True)).to_have_count(0)
            page.screenshot(path=str(ARTIFACTS / "overview-empty.png"))
            for width in [320, 390]:
                page.set_viewport_size({"width": width, "height": 844})
                assert page.evaluate("document.documentElement.scrollWidth <= innerWidth"), "Overview overflows on mobile"
            page.screenshot(path=str(ARTIFACTS / "overview-mobile.png"), full_page=True)
            page.set_viewport_size({"width": 1440, "height": 1100})
            page.get_by_role("link", name="Set up Service App", exact=True).click()
            expect(page.get_by_role("heading", name="Developer Connections", exact=True)).to_be_visible()
            expect(page.get_by_role("radio")).to_have_count(0)
            nav = page.get_by_role("navigation", name="Provider navigation")
            expect(nav.get_by_role("link", name="Service App Needs setup", exact=True)).to_be_visible()
            expect(nav.get_by_role("link", name="Developer Integration Needs setup", exact=True)).to_be_visible()
            expect(page.get_by_label("Developer Integration client ID", exact=True)).to_have_count(0)
            expect(page.get_by_role("table")).to_have_count(0)
            for width in [320, 390]:
                page.set_viewport_size({"width": width, "height": 844})
                assert page.evaluate("document.documentElement.scrollWidth <= innerWidth"), "Provider setup overflows on mobile"
            page.screenshot(path=str(ARTIFACTS / "provider-setup-mobile.png"), full_page=True)
            page.set_viewport_size({"width": 1440, "height": 1100})
            page.screenshot(path=str(ARTIFACTS / "provider-setup.png"))
            page.get_by_text("Optional Data Source and webhooks", exact=True).click()
            for label, value in [
                ("Service App name (optional)", "Sample Directory Service App"),
                ("Service App manage URL (optional)", "https://developer.webex.com/my-apps/sample-directory-service-app"),
                ("Service App ID", "sample-service-app"), ("Service App client ID", "sample-service-client"),
                ("Service App client secret", client_secret),
                ("Data Source schema ID", "5397013b-7920-4ffc-807c-e8a3e0a18f43"),
                ("Data Source endpoint base URL", "https://connector.example.com"),
            ]:
                page.get_by_label(label, exact=True).fill(value)
            page.get_by_role("button", name="Save Service App", exact=True).click()
            expect(page.get_by_role("status")).to_contain_text("Service App saved securely")
            expect(page.locator(".service-app-details")).to_contain_text("Sample Directory Service App")
            expect(nav.get_by_role("link", name="Service App Configured", exact=True)).to_be_visible()
            expect(page.get_by_role("link", name="Manage Service App", exact=True)).to_have_attribute("href", "https://developer.webex.com/my-apps/sample-directory-service-app")
            for width in [320, 390]:
                page.set_viewport_size({"width": width, "height": 844})
                assert page.evaluate("document.documentElement.scrollWidth <= innerWidth"), "Service App details overflow on mobile"
            page.set_viewport_size({"width": 1440, "height": 1100})
            page.locator(".service-app-details").screenshot(path=str(ARTIFACTS / "service-app-details.png"))
            page.get_by_role("link", name="Continue to Developer Integration", exact=True).click()
            expect(page.get_by_label("Service App client ID", exact=True)).to_have_count(0)
            page.get_by_label("Developer Integration client ID", exact=True).fill("sample-provider-client")
            page.get_by_label("Developer Integration client secret", exact=True).fill(client_secret)
            expect(page.get_by_role("button", name="Connect Webex developer", exact=True)).to_be_disabled()
            page.get_by_role("button", name="Save Developer Integration", exact=True).click()
            expect(page.get_by_role("button", name="Connect Webex developer", exact=True)).to_be_enabled()
            expect(nav.get_by_role("link", name="Developer Integration Ready to connect", exact=True)).to_be_visible()
            page.screenshot(path=str(ARTIFACTS / "developer-integration.png"))
            for width in [320, 390]:
                page.set_viewport_size({"width": width, "height": 844})
                assert page.evaluate("document.documentElement.scrollWidth <= innerWidth"), "Developer Integration overflows on mobile"
            page.screenshot(path=str(ARTIFACTS / "developer-integration-mobile.png"), full_page=True)
            page.set_viewport_size({"width": 1440, "height": 1100})
            expect(page.get_by_role("link", name="Continue to Customer Verification", exact=True)).to_have_count(0)
            nav.get_by_role("link", name="Customer Verification Needs setup", exact=True).click()
            page.get_by_label("Customer Integration client ID", exact=True).fill("sample-customer-client")
            page.get_by_label("Customer Integration client secret", exact=True).fill(client_secret)
            page.get_by_role("button", name="Save Customer Verification", exact=True).click()
            expect(nav.get_by_role("link", name="Customer Verification Configured", exact=True)).to_be_visible()
            page.get_by_role("link", name="Open Customers", exact=True).click()
            expect(page.get_by_role("heading", name="Customers", exact=True)).to_be_visible()
            expect(page.get_by_role("table")).to_be_visible()
            expect(page.get_by_label("Service App client ID", exact=True)).to_have_count(0)
            page.reload()
            expect(page.get_by_role("heading", name="Customers", exact=True)).to_be_visible()
            nav.get_by_role("link", name="Connection History", exact=True).click()
            expect(page.get_by_role("heading", name="Connection History", exact=True)).to_be_visible()
            page.go_back()
            expect(page.get_by_role("heading", name="Customers", exact=True)).to_be_visible()
            page.get_by_label("Experience", exact=True).select_option("summit")
            expect(page.get_by_role("heading", name="Your Webex organization", exact=True)).to_be_visible()
            expect(page.get_by_role("button", name="Verify with Webex →", exact=True)).to_be_visible()
            page.reload()
            expect(page.get_by_label("Experience", exact=True)).to_have_value("summit")
            page.get_by_label("Experience", exact=True).select_option("northstar")
            expect(page.get_by_label("Experience", exact=True)).to_have_value("northstar")
            expect(page.get_by_text("Northstar Travel", exact=True).first).to_be_visible()
            for width in [320, 390]:
                page.set_viewport_size({"width": width, "height": 844})
                assert page.evaluate("document.documentElement.scrollWidth <= innerWidth"), "Experience selector overflows on mobile"
            page.screenshot(path=str(ARTIFACTS / "local-customer-mobile.png"), full_page=True)
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
            expect(page.get_by_label("Experience", exact=True)).to_have_value("provider")
            page.screenshot(path=str(ARTIFACTS / "local-provider.png"))
            expect(page.get_by_role("heading", name="Overview", exact=True)).to_be_visible()
            expect(page.get_by_role("link", name="Connect your Webex developer account", exact=True)).to_be_visible()
            page.get_by_role("navigation", name="Provider navigation").get_by_role("link", name="Service App Configured", exact=True).click()
            page.get_by_role("button", name="Edit Service App", exact=True).click()
            expect(page.get_by_label("Service App ID", exact=True)).to_have_value("sample-service-app")
            expect(page.get_by_label("Service App name (optional)", exact=True)).to_have_value("Sample Directory Service App")
            expect(page.get_by_label("Service App manage URL (optional)", exact=True)).to_have_value("https://developer.webex.com/my-apps/sample-directory-service-app")
            expect(page.get_by_label("Data Source endpoint base URL", exact=True)).to_have_value("https://connector.example.com")
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
        environment = {
            **os.environ,
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

                def workspace(perspective):
                    context = browser.new_context(viewport={"width": 1440, "height": 1100})
                    page = context.new_page()
                    observe(page)
                    page.goto(base_url)
                    page.wait_for_load_state("networkidle")
                    expect(page.get_by_label("Experience", exact=True)).to_have_value("provider")
                    expect(page.get_by_label("Experience", exact=True)).to_be_in_viewport()
                    expect(page.get_by_label("Password", exact=True)).to_have_count(0)
                    if perspective != "provider":
                        page.get_by_label("Experience", exact=True).select_option(perspective)
                        expect(page.get_by_role("heading", name="Your Webex organization", exact=True)).to_be_visible()
                    return context, page

                provider_context, provider = workspace("provider")
                assert provider.evaluate("customElements.get('mdc-button') && document.querySelector('mdc-button').shadowRoot"), "Momentum buttons did not hydrate"
                provider.evaluate("document.fonts.ready")
                assert provider.evaluate("document.fonts.check('15px Momentum')"), "Local Momentum font did not load"
                provider.get_by_role("navigation", name="Provider navigation").get_by_role("link", name="Developer Integration Ready to connect", exact=True).click()
                provider.get_by_role("button", name="Connect demo Integration", exact=True).press("Enter")
                expect(provider.get_by_text("Demo provider Integration connected.", exact=True)).to_be_visible()
                expect(provider.get_by_role("link", name="Continue to Customer Verification", exact=True)).to_be_visible()
                expect(provider.get_by_role("navigation", name="Provider navigation").get_by_role("link", name="Developer Integration Connected", exact=True)).to_be_visible()
                provider.get_by_role("navigation", name="Provider navigation").get_by_role("link", name="Customers", exact=True).click()
                provider.get_by_role("button", name="Authorize Summit Outfitters Webex", exact=True).press("Space")
                expect(provider.get_by_role("button", name="Deauthorize Summit Outfitters Webex", exact=True)).to_be_visible()

                customer_context, customer = workspace("summit")
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

                source = customer.locator("#data-source")
                expect(source.get_by_role("heading", name="Customer Data Source", exact=True)).to_be_visible()
                expect(source).to_contain_text("https://provider.example/customers/summit")
                source.get_by_text("Register a data source", exact=True).click()
                source.get_by_role("button", name="Confirm register data source", exact=True).click()
                expect(customer.get_by_role("status")).to_contain_text("Data Source registered")
                expect(source.get_by_text("active", exact=True)).to_be_visible()
                source.get_by_role("button", name="Renew delivery token", exact=True).click()
                expect(customer.get_by_role("status")).to_contain_text("delivery token renewed")
                source.get_by_role("button", name="Refresh data source", exact=True).click()
                expect(customer.get_by_role("status")).to_contain_text("status refreshed")
                source.screenshot(path=str(ARTIFACTS / "customer-data-source.png"))
                check_mobile(customer, "customer-data-source")
                customer.reload()
                expect(source.get_by_text("active", exact=True)).to_be_visible()

                other_context, other = workspace("northstar")
                other.get_by_label("Fixture organization").select_option("demo-summit")
                other.get_by_role("button", name="Verify fixture identity", exact=True).click()
                other.get_by_role("button", name="Confirm link and activate Service App", exact=True).click()
                expect(other.get_by_role("alert")).to_contain_text("already linked")
                expect(other.get_by_role("heading", name="Organization directory", exact=True)).to_have_count(0)

                provider.get_by_role("button", name="Refresh status", exact=True).click()
                provider.get_by_role("navigation", name="Provider navigation").get_by_role("link", name="Overview", exact=True).click()
                expect(provider.locator(".overview-count")).to_have_text("1 / 2")
                expect(provider.get_by_role("link", name="Manage customer connections", exact=True)).to_be_visible()
                expect(provider.locator(".overview-last-read")).not_to_contain_text("Not yet")
                expect(provider.get_by_role("table")).to_have_count(0)
                provider.screenshot(path=str(ARTIFACTS / "overview.png"))
                check_mobile(provider, "overview-connected")
                provider.reload()
                expect(provider.get_by_role("heading", name="Overview", exact=True)).to_be_visible()
                expect(provider.locator(".overview-count")).to_have_text("1 / 2")
                provider.get_by_role("navigation", name="Provider navigation").get_by_role("link", name="Customers", exact=True).click()
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
                expect(source).to_contain_text("registration remains in Webex")
                expect(source.get_by_role("button", name="Renew delivery token", exact=True)).to_be_disabled()
                customer.get_by_role("button", name="Verify fixture identity", exact=True).click()
                customer.get_by_role("button", name="Confirm link and activate Service App", exact=True).click()
                expect(customer.get_by_role("heading", name="Organization directory", exact=True)).to_be_visible()
                source.get_by_text("Remove data source", exact=True).click()
                source.get_by_role("button", name="Confirm remove data source", exact=True).click()
                expect(customer.get_by_role("status")).to_contain_text("Data Source removed")
                expect(source.get_by_text("Register a data source", exact=True)).to_be_visible()
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
            print("Browser smoke passed: password-free local perspectives, no-env setup/restart, encrypted credentials, Momentum controls, explicit linking, pagination, claim conflict, Data Source register/read/renew/remove and reload persistence, disconnect/reconnect, deauthorization, and 320/390px layouts.")
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
