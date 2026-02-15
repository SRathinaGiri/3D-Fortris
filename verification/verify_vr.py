from playwright.sync_api import sync_playwright

def run():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()
        page.goto("http://127.0.0.1:8000/VR/index.html")

        # Wait for the button to appear (it is created by VRButton.js)
        # It might take a moment for the check to run
        page.wait_for_timeout(2000)

        # Take a screenshot
        page.screenshot(path="verification/vr_button.png")

        browser.close()

if __name__ == "__main__":
    run()
