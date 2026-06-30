package com.nat.base;

import org.openqa.selenium.*;
import org.openqa.selenium.support.ui.*;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.io.File;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Paths;
import java.time.Duration;
import java.time.LocalDateTime;
import java.time.format.DateTimeFormatter;

/**
 * Abstract base class for all Page Objects.
 * Provides common WebDriver interactions with built-in waits,
 * logging, and screenshot capture.
 *
 * <p>Usage: extend this class for every page in your application.
 * <pre>
 * public class LoginPage extends BasePage {
 *     public LoginPage(WebDriver driver) { super(driver); }
 * }
 * </pre>
 */
public abstract class BasePage {

    protected final WebDriver driver;
    protected final WebDriverWait wait;
    private static final Logger log = LoggerFactory.getLogger(BasePage.class);
    private static final int DEFAULT_WAIT_SECONDS = 15;
    private static final String SCREENSHOT_DIR = "target/screenshots/";

    /**
     * Constructs a BasePage with the given WebDriver.
     * Initialises a 15-second explicit wait.
     *
     * @param driver the WebDriver instance for this page
     */
    public BasePage(WebDriver driver) {
        this.driver = driver;
        this.wait   = new WebDriverWait(driver, Duration.ofSeconds(DEFAULT_WAIT_SECONDS));
    }

    /**
     * Navigates the browser to the given URL.
     *
     * @param url the full URL to navigate to
     */
    public void navigateTo(String url) {
        log.info("Navigating to: {}", url);
        driver.get(url);
        waitForPageLoad();
    }

    /**
     * Clicks a web element after waiting for it to be clickable.
     * Scrolls to the element first to ensure it is in the viewport.
     *
     * @param element the element to click
     */
    public void clickElement(WebElement element) {
        wait.until(ExpectedConditions.elementToBeClickable(element));
        scrollToElement(element);
        log.info("Clicking element: <{}>", element.getTagName());
        element.click();
    }

    /**
     * Fills an input field. Clears any existing value before typing.
     *
     * @param element the input element to fill
     * @param value   the value to enter
     */
    public void fillInput(WebElement element, String value) {
        wait.until(ExpectedConditions.visibilityOf(element));
        element.clear();
        element.sendKeys(value);
        log.info("Filled input field '{}' with {} characters",
                element.getAttribute("name") != null ? element.getAttribute("name") : element.getTagName(),
                value.length());
    }

    /**
     * Returns the trimmed visible text of an element,
     * waiting for the element to be visible first.
     *
     * @param element the element to read text from
     * @return trimmed text content
     */
    public String getText(WebElement element) {
        wait.until(ExpectedConditions.visibilityOf(element));
        String text = element.getText().trim();
        log.debug("Got text '{}' from element <{}>", text, element.getTagName());
        return text;
    }

    /**
     * Checks whether an element is currently visible without throwing.
     *
     * @param element the element to check
     * @return true if visible, false otherwise
     */
    public boolean isElementVisible(WebElement element) {
        try {
            return element.isDisplayed();
        } catch (NoSuchElementException | StaleElementReferenceException e) {
            return false;
        }
    }

    /**
     * Waits until document.readyState is "complete".
     * Ensures the page has fully loaded before proceeding.
     */
    public void waitForPageLoad() {
        wait.until(driver -> ((JavascriptExecutor) driver)
                .executeScript("return document.readyState")
                .equals("complete"));
        log.debug("Page load complete: {}", driver.getCurrentUrl());
    }

    /**
     * Scrolls the browser viewport to bring the element into view.
     *
     * @param element the element to scroll to
     */
    public void scrollToElement(WebElement element) {
        ((JavascriptExecutor) driver).executeScript(
                "arguments[0].scrollIntoView({behavior: 'smooth', block: 'center'});",
                element);
    }

    /**
     * Takes a PNG screenshot and saves it to target/screenshots/.
     * Filename includes the given name and a timestamp.
     *
     * @param name a descriptive label for the screenshot file
     */
    public void takeScreenshot(String name) {
        try {
            File screenshotDir = new File(SCREENSHOT_DIR);
            if (!screenshotDir.exists()) {
                screenshotDir.mkdirs();
            }
            String timestamp = LocalDateTime.now()
                    .format(DateTimeFormatter.ofPattern("yyyyMMdd_HHmmss_SSS"));
            String filename = SCREENSHOT_DIR + name + "_" + timestamp + ".png";
            File srcFile = ((TakesScreenshot) driver).getScreenshotAs(OutputType.FILE);
            Files.copy(srcFile.toPath(), Paths.get(filename));
            log.info("Screenshot saved: {}", filename);
        } catch (IOException e) {
            log.error("Failed to save screenshot '{}': {}", name, e.getMessage());
        }
    }

    /**
     * Waits for an element matching the given locator to become visible.
     *
     * @param locator the By locator to wait for
     * @return the visible WebElement
     */
    public WebElement waitForElement(By locator) {
        log.debug("Waiting for element: {}", locator);
        return wait.until(ExpectedConditions.visibilityOfElementLocated(locator));
    }
}
