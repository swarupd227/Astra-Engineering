package com.nat.utils;

import org.openqa.selenium.WebDriver;
import org.openqa.selenium.WebElement;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.testng.asserts.SoftAssert;

/**
 * Assertion utilities wrapping TestNG hard and soft assertions.
 * All static methods log results for traceability in reports.
 */
public class AssertUtils {

    private static final Logger log = LoggerFactory.getLogger(AssertUtils.class);

    private AssertUtils() {}

    /**
     * Hard-asserts that an element is displayed.
     *
     * @param element the element to check
     * @param message a descriptive failure message
     */
    public static void assertVisible(WebElement element, String message) {
        boolean visible = false;
        try {
            visible = element.isDisplayed();
        } catch (Exception ignored) {}
        if (!visible) {
            log.error("ASSERT FAILED (assertVisible): {}", message);
            throw new AssertionError("Element not visible: " + message);
        }
        log.info("ASSERT PASS (assertVisible): {}", message);
    }

    /**
     * Hard-asserts that an element's text matches the expected value (trimmed).
     *
     * @param element  the element to read text from
     * @param expected the expected text
     */
    public static void assertText(WebElement element, String expected) {
        String actual = element.getText().trim();
        if (!actual.equals(expected)) {
            String msg = String.format("Text mismatch — expected: '%s', actual: '%s'", expected, actual);
            log.error("ASSERT FAILED (assertText): {}", msg);
            throw new AssertionError(msg);
        }
        log.info("ASSERT PASS (assertText): '{}'", expected);
    }

    /**
     * Hard-asserts that the current URL contains the expected fragment.
     *
     * @param driver          the WebDriver
     * @param expectedFragment the URL substring to assert
     */
    public static void assertUrl(WebDriver driver, String expectedFragment) {
        String actualUrl = driver.getCurrentUrl();
        if (!actualUrl.contains(expectedFragment)) {
            String msg = String.format("URL mismatch — expected to contain: '%s', actual: '%s'",
                    expectedFragment, actualUrl);
            log.error("ASSERT FAILED (assertUrl): {}", msg);
            throw new AssertionError(msg);
        }
        log.info("ASSERT PASS (assertUrl): URL contains '{}'", expectedFragment);
    }

    /**
     * Hard-asserts that the page title matches the expected value (trimmed).
     *
     * @param driver   the WebDriver
     * @param expected the expected page title
     */
    public static void assertTitle(WebDriver driver, String expected) {
        String actual = driver.getTitle().trim();
        if (!actual.equals(expected)) {
            String msg = String.format("Title mismatch — expected: '%s', actual: '%s'", expected, actual);
            log.error("ASSERT FAILED (assertTitle): {}", msg);
            throw new AssertionError(msg);
        }
        log.info("ASSERT PASS (assertTitle): '{}'", expected);
    }

    /**
     * Hard-asserts that an element is enabled (interactable).
     *
     * @param element the element to check
     * @param message a descriptive failure message
     */
    public static void assertEnabled(WebElement element, String message) {
        if (!element.isEnabled()) {
            log.error("ASSERT FAILED (assertEnabled): {}", message);
            throw new AssertionError("Element not enabled: " + message);
        }
        log.info("ASSERT PASS (assertEnabled): {}", message);
    }

    /**
     * Soft-asserts that an element is visible. Collects failure without stopping the test.
     *
     * @param softAssert the SoftAssert instance (shared within the test method)
     * @param element    the element to check
     * @param message    a descriptive failure message
     */
    public static void softAssertVisible(SoftAssert softAssert, WebElement element, String message) {
        boolean visible = false;
        try {
            visible = element.isDisplayed();
        } catch (Exception ignored) {}
        softAssert.assertTrue(visible, "Soft assert visible: " + message);
        if (visible) log.info("SOFT ASSERT PASS (visible): {}", message);
        else         log.warn("SOFT ASSERT FAIL (visible): {}", message);
    }

    /**
     * Soft-asserts that an element's text matches the expected value.
     *
     * @param softAssert the SoftAssert instance
     * @param element    the element to read text from
     * @param expected   the expected text
     * @param message    a descriptive failure message
     */
    public static void softAssertText(SoftAssert softAssert, WebElement element,
                                       String expected, String message) {
        String actual = "";
        try {
            actual = element.getText().trim();
        } catch (Exception ignored) {}
        softAssert.assertEquals(actual, expected, "Soft assert text: " + message);
        if (actual.equals(expected)) log.info("SOFT ASSERT PASS (text): {}", message);
        else log.warn("SOFT ASSERT FAIL (text): expected='{}', actual='{}'", expected, actual);
    }
}
