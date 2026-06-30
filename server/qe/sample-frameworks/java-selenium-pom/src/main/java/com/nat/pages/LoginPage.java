package com.nat.pages;

import com.nat.base.BasePage;
import org.openqa.selenium.WebDriver;
import org.openqa.selenium.WebElement;
import org.openqa.selenium.support.FindBy;
import org.openqa.selenium.support.PageFactory;

/**
 * Page Object for the Login page.
 * Demonstrates the POM pattern: locators as fields, actions as methods.
 *
 * <p>Usage:
 * <pre>
 * LoginPage loginPage = new LoginPage(driver);
 * loginPage.login("user@example.com", "password123");
 * </pre>
 */
public class LoginPage extends BasePage {

    // ── Locators ──────────────────────────────────────────────────────────────

    @FindBy(id = "username")
    private WebElement usernameField;

    @FindBy(id = "password")
    private WebElement passwordField;

    @FindBy(css = "button[type='submit']")
    private WebElement loginButton;

    @FindBy(css = ".error-message")
    private WebElement errorMessage;

    @FindBy(css = ".flash-message, .alert-success")
    private WebElement successMessage;

    // ── Constructor ───────────────────────────────────────────────────────────

    /**
     * Constructs LoginPage and initialises @FindBy elements via PageFactory.
     *
     * @param driver the WebDriver for this page
     */
    public LoginPage(WebDriver driver) {
        super(driver);
        PageFactory.initElements(driver, this);
    }

    // ── Actions ───────────────────────────────────────────────────────────────

    /**
     * Enters a value into the username input field.
     *
     * @param username the username to enter
     */
    public void enterUsername(String username) {
        fillInput(usernameField, username);
    }

    /**
     * Enters a value into the password input field.
     *
     * @param password the password to enter
     */
    public void enterPassword(String password) {
        fillInput(passwordField, password);
    }

    /**
     * Clicks the login submit button.
     */
    public void clickLogin() {
        clickElement(loginButton);
    }

    /**
     * Returns true if an error message element is visible.
     *
     * @return true if error is displayed
     */
    public boolean isErrorMessageVisible() {
        return isElementVisible(errorMessage);
    }

    /**
     * Returns the visible text of the error message element.
     *
     * @return the error message string
     */
    public String getErrorMessage() {
        return getText(errorMessage);
    }

    /**
     * Returns the error message WebElement directly.
     * Used by AssertUtils for element-level assertions.
     *
     * @return the error message WebElement
     */
    public WebElement getErrorMessageElement() {
        return errorMessage;
    }

    /**
     * Convenience method: enters username and password, then clicks login.
     *
     * @param username the username
     * @param password the password
     */
    public void login(String username, String password) {
        enterUsername(username);
        enterPassword(password);
        clickLogin();
    }
}
