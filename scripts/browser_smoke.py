"""Isolated browser smoke tests. Never reads .env or contacts Webex."""
import os
import re
from pathlib import Path
import socket
import subprocess
import tempfile
from playwright.sync_api import sync_playwright, expect

ROOT = Path(__file__).resolve().parent.parent
ARTIFACTS = ROOT / 'artifacts'


def mobile(page):
    for width in [320, 390]:
        page.set_viewport_size({'width': width, 'height': 844})
        assert page.evaluate('document.documentElement.scrollWidth <= innerWidth'), 'Mobile overflow'
    page.set_viewport_size({'width': 1440, 'height': 1100})


def start(directory, demo=False):
    with socket.socket() as sock:
        sock.bind(('127.0.0.1', 0))
        port = sock.getsockname()[1]
    proc = subprocess.Popen(['node', 'server.mjs', '--port', str(port), '--data-dir', directory] + (['--demo'] if demo else []),
                            cwd=ROOT, env={'PATH': os.environ['PATH']}, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    assert 'mode' in proc.stdout.readline(), 'Server did not start'
    return proc, f'http://localhost:{port}'


def stop(proc):
    proc.terminate()
    proc.wait(timeout=10)


def main():
    ARTIFACTS.mkdir(exist_ok=True)
    with sync_playwright() as p, tempfile.TemporaryDirectory(prefix='service-app-console-') as directory:
        browser = p.chromium.launch()
        context = browser.new_context(viewport={'width': 1440, 'height': 1100})
        page = context.new_page()
        errors, external = [], []
        page.on('pageerror', lambda err: errors.append(str(err)))
        page.on('request', lambda req: external.append(req.url) if not req.url.startswith('http://localhost:') else None)
        proc, url = start(directory)
        try:
            page.goto(url)
            expect(page.get_by_role('heading', name='Service App Studio', exact=True)).to_be_visible()
            expect(page.get_by_label('Password', exact=True)).to_have_count(0)
            expect(page.get_by_role('combobox')).to_have_count(0)
            mobile(page)
            page.get_by_role('navigation').get_by_role('link', name='Service App Needs setup', exact=True).click()
            for label, value in [('Service App name', 'Fixture Service App'), ('Manage URL', 'https://developer.webex.com/my-apps/fixture-service-app'),
                                 ('Service App ID', 'fixture-app'), ('Client ID', 'fixture-client'), ('Client secret', 'fixture-private-secret')]:
                page.get_by_label(label, exact=True).fill(value)
            page.get_by_role('button', name='Save Service App', exact=True).click()
            expect(page.get_by_role('status')).to_contain_text('Service App saved')
            expect(page.get_by_role('link', name='Manage in Webex')).to_have_attribute('href', 'https://developer.webex.com/my-apps/fixture-service-app')
            expect(page.get_by_label('Client secret', exact=True)).to_have_value('')
            mobile(page)
            page.screenshot(path=str(ARTIFACTS / 'service-app-setup.png'))
            assert b'fixture-private-secret' not in (Path(directory) / 'live.sqlite').read_bytes()
            stop(proc)
            proc, url = start(directory)
            page.goto(url + '/#service-app')
            expect(page.get_by_label('Client ID', exact=True)).to_have_value('fixture-client')
            page.get_by_role('navigation').get_by_role('link', name='Developer Access Needs PAT', exact=True).click()
            expect(page.get_by_label('Personal access token', exact=True)).to_have_value('')
            expect(page.get_by_role('button', name='Connect PAT', exact=True)).to_be_enabled()
            mobile(page)
            stop(proc)
            proc, url = start(directory, demo=True)
            page.goto(url + '/#developer-access')
            page.get_by_role('button', name='Connect demo developer', exact=True).press('Enter')
            expect(page.get_by_role('status')).to_contain_text('Demo developer connected')
            page.get_by_role('navigation').get_by_role('link', name='Organizations', exact=True).click()
            expect(page.get_by_role('heading', name='Summit Outfitters', exact=True)).to_be_visible()
            expect(page.get_by_label('Personal access token', exact=True)).to_have_count(0)
            page.get_by_text('Manage tokens', exact=True).click()
            page.get_by_role('button', name='Retrieve token pair', exact=True).click()
            expect(page.get_by_label('Access token', exact=True)).to_have_value(re.compile('^demo-access-'))
            expect(page.get_by_label('Refresh token', exact=True)).to_have_value(re.compile('^demo-refresh-'))
            mobile(page)
            page.get_by_role('button', name='Hide tokens', exact=True).click()
            expect(page.get_by_label('Access token', exact=True)).to_have_count(0)
            page.get_by_text('Manage tokens', exact=True).click()
            page.get_by_role('button', name='Refresh token pair', exact=True).click()
            expect(page.get_by_role('status')).to_contain_text('token pair saved')
            page.goto('about:blank')
            page.go_back()
            expect(page.get_by_role('heading', name='Organizations', exact=True)).to_be_visible()
            expect(page.get_by_label('Access token', exact=True)).to_have_count(0)
            page.get_by_role('navigation').get_by_role('link', name='Overview', exact=True).click()
            expect(page.get_by_label('Access token', exact=True)).to_have_count(0)
            page.screenshot(path=str(ARTIFACTS / 'overview.png'))
            page.get_by_role('navigation').get_by_role('link', name='Organizations', exact=True).click()
            page.reload()
            expect(page.get_by_text('Saved token · Access expires', exact=False)).to_be_visible()
            page.screenshot(path=str(ARTIFACTS / 'organizations.png'))
            mobile(page)
            page.get_by_role('button', name='Revoke demo approval', exact=True).click()
            page.get_by_text('Manage tokens', exact=True).click()
            page.get_by_role('button', name='Reveal saved pair', exact=True).click()
            expect(page.get_by_role('alert')).to_contain_text('not currently approved')
            expect(page.get_by_role('heading', name='Summit Outfitters', exact=True)).to_have_count(0)
            page.get_by_role('navigation').get_by_role('link', name='Developer Access Connected', exact=True).click()
            page.get_by_role('button', name='Disconnect PAT', exact=True).click()
            expect(page.get_by_text('Not connected', exact=True)).to_be_visible()
            page.reload()
            expect(page.get_by_text('Not connected', exact=True)).to_be_visible()
            assert not errors, errors
            assert not external, 'Unexpected external request'
            assert page.evaluate("customElements.get('mdc-button') !== undefined"), 'Momentum did not load'
            print('Browser smoke passed: no-env setup/restart, encrypted secret, PAT view, approval list, retrieve/refresh/reveal boundaries, persistence, revocation, disconnect, Momentum and 320/390px layouts.')
        finally:
            if proc.poll() is None:
                stop(proc)
            context.close()
            browser.close()


if __name__ == '__main__':
    main()
