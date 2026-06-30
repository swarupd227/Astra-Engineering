package com.nat.utils;

import org.openqa.selenium.By;
import org.openqa.selenium.JavascriptExecutor;
import org.openqa.selenium.WebDriver;
import org.openqa.selenium.WebElement;
import org.openqa.selenium.support.ui.*;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.time.Duration;
import java.util.function.Function;

/**
 * Utility class providing explicit and fluent wait strategies.
 * All methods are static; instantiation is not needed.
 */
public class WaitUtils {

    private static final Logger log = LoggerFactory.getLogger(WaitUtils.class);

    private WaitUtils() {}

    /**
     * Waits for an element to become visible.
     *
     * @param driver  the WebDriver
     * @param locator the element locator
     * @param seconds max wait time in seconds
     * @return the visible WebElement
     */
    public static WebElement waitForVisible(WebDriver driver, By locator, int seconds) {
        log.debug("Waiting up to {}s for visibility of: {}", seconds, locator);
        return new WebDriverWait(driver, Duration.ofSeconds(seconds))
                .until(ExpectedConditions.visibilityOfElementLocated(locator));
    }

    /**
     * Waits for an element to become clickable.
     *
     * @param driver  the WebDriver
     * @param locator the element locator
     * @param seconds max wait time in seconds
     * @return the clickable WebElement
     */
    public static WebElement waitForClickable(WebDriver driver, By locator, int seconds) {
        log.debug("Waiting up to {}s for clickability of: {}", seconds, locator);
        return new WebDriverWait(driver, Duration.ofSeconds(seconds))
                .until(ExpectedConditions.elementToBeClickable(locator));
    }

    /**
     * Waits until an element contains the expected text.
     *
     * @param driver   the WebDriver
     * @param locator  the element locator
     * @param text     the expected text substring
     * @param seconds  max wait time in seconds
     */
    public static void waitForText(WebDriver driver, By locator, String text, int seconds) {
        log.debug("Waiting up to {}s for text '{}' in: {}", seconds, text, locator);
        new WebDriverWait(driver, Duration.ofSeconds(seconds))
                .until(ExpectedConditions.textToBePresentInElementLocated(locator, text));
    }

    /**
     * Waits until the current URL contains the given fragment.
     *
     * @param driver      the WebDriver
     * @param urlFragment the URL substring to wait for
     * @param seconds     max wait time in seconds
     */
    public static void waitForUrl(WebDriver driver, String urlFragment, int seconds) {
        log.debug("Waiting up to {}s for URL to contain: {}", seconds, urlFragment);
        new WebDriverWait(driver, Duration.ofSeconds(seconds))
                .until(ExpectedConditions.urlContains(urlFragment));
    }

    /**
     * Waits until document.readyState equals "complete".
     *
     * @param driver the WebDriver
     */
    public static void waitForPageLoad(WebDriver driver) {
        new WebDriverWait(driver, Duration.ofSeconds(30)).until(d ->
                ((JavascriptExecutor) d).executeScript("return document.readyState").equals("complete"));
        log.debug("Page load complete: {}", driver.getCurrentUrl());
    }

    /**
     * FluentWait — polls for element visibility with a custom polling interval.
     * Ignores NoSuchElementException during polling.
     *
     * @param driver   the WebDriver
     * @param locator  the element locator
     * @param timeout  max wait time in seconds
     * @param polling  polling interval in milliseconds
     * @return the visible WebElement
     */
    public static WebElement fluentWait(WebDriver driver, By locator, int timeout, int polling) {
        log.debug("FluentWait: timeout={}s, polling={}ms for: {}", timeout, polling, locator);
        Wait<WebDriver> fluentWait = new FluentWait<>(driver)
                .withTimeout(Duration.ofSeconds(timeout))
                .pollingEvery(Duration.ofMillis(polling))
                .ignoring(org.openqa.selenium.NoSuchElementException.class);
        return fluentWait.until(d -> d.findElement(locator));
    }
}
