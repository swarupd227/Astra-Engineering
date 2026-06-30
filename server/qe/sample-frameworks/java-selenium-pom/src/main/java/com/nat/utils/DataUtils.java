package com.nat.utils;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.io.IOException;
import java.io.InputStream;
import java.nio.file.Files;
import java.nio.file.Paths;
import java.time.Instant;
import java.util.*;

/**
 * Utility class for test data management.
 * Provides JSON file reading, property loading, and random data generation.
 */
public class DataUtils {

    private static final Logger log = LoggerFactory.getLogger(DataUtils.class);
    private static final ObjectMapper objectMapper = new ObjectMapper();
    private static Properties configProperties;

    private DataUtils() {}

    /**
     * Reads a JSON file and returns its contents as a Map.
     *
     * @param filePath path to the JSON file (relative to the project root)
     * @return a Map representation of the JSON object
     * @throws RuntimeException if the file cannot be read or parsed
     */
    @SuppressWarnings("unchecked")
    public static Map<String, Object> readJsonFile(String filePath) {
        try {
            log.debug("Reading JSON from: {}", filePath);
            byte[] content = Files.readAllBytes(Paths.get(filePath));
            return objectMapper.readValue(content, Map.class);
        } catch (IOException e) {
            log.error("Failed to read JSON file '{}': {}", filePath, e.getMessage());
            throw new RuntimeException("Cannot read JSON file: " + filePath, e);
        }
    }

    /**
     * Reads a value from config.properties by key.
     * Loads the file on first call and caches it.
     *
     * @param key the property key
     * @return the property value, or null if not found
     */
    public static String readProperty(String key) {
        if (configProperties == null) {
            configProperties = new Properties();
            try (InputStream is = DataUtils.class.getClassLoader()
                    .getResourceAsStream("config.properties")) {
                if (is != null) {
                    configProperties.load(is);
                    log.debug("Loaded config.properties");
                } else {
                    log.warn("config.properties not found on classpath");
                }
            } catch (IOException e) {
                log.error("Failed to load config.properties: {}", e.getMessage());
            }
        }
        String value = configProperties.getProperty(key);
        log.debug("Property '{}' = '{}'", key, value);
        return value;
    }

    /**
     * Generates a unique random email address using the current timestamp.
     *
     * @return a unique email string such as user_1710000000000@test.nat.com
     */
    public static String generateRandomEmail() {
        String email = "user_" + Instant.now().toEpochMilli() + "@test.nat.com";
        log.debug("Generated email: {}", email);
        return email;
    }

    /**
     * Generates a random alphanumeric string of the given length.
     *
     * @param length the number of characters to generate
     * @return a random alphanumeric string
     */
    public static String generateRandomString(int length) {
        String chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
        Random random = new Random();
        StringBuilder sb = new StringBuilder();
        for (int i = 0; i < length; i++) {
            sb.append(chars.charAt(random.nextInt(chars.length())));
        }
        String result = sb.toString();
        log.debug("Generated string of length {}: {}", length, result);
        return result;
    }

    /**
     * Generates a random 10-digit US phone number in format 555-XXX-XXXX.
     *
     * @return a formatted phone number string
     */
    public static String generateRandomPhone() {
        Random random = new Random();
        String phone = String.format("555-%03d-%04d",
                random.nextInt(1000),
                random.nextInt(10000));
        log.debug("Generated phone: {}", phone);
        return phone;
    }
}
