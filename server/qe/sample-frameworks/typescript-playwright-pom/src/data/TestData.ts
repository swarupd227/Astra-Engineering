import { faker } from '@faker-js/faker';

// ── Interfaces ─────────────────────────────────────────────────────────────────

export interface LoginData {
  username: string;
  password: string;
}

export interface ContactFormData {
  firstName: string;
  lastName:  string;
  email:     string;
  phone:     string;
  subject:   string;
  message:   string;
}

export interface CareerFormData {
  firstName:  string;
  lastName:   string;
  email:      string;
  phone:      string;
  position:   string;
  coverLetter: string;
  linkedIn:   string;
}

export interface RegistrationData {
  username:        string;
  email:           string;
  password:        string;
  confirmPassword: string;
  firstName:       string;
  lastName:        string;
}

// ── Static test data ───────────────────────────────────────────────────────────

export const VALID_USER: LoginData = {
  username: 'testuser@example.com',
  password: 'Test@1234!',
};

export const INVALID_USER: LoginData = {
  username: 'wrong@example.com',
  password: 'wrongpassword',
};

export const EMPTY_USER: LoginData = {
  username: '',
  password: '',
};

export const XSS_PAYLOADS = [
  '<script>alert("xss")</script>',
  '"><img src=x onerror=alert(1)>',
  "'; DROP TABLE users; --",
  '{{7*7}}',
  '${7*7}',
] as const;

// ── Dynamic data generators ────────────────────────────────────────────────────

/**
 * Generates realistic contact form data using Faker.
 */
export function generateContactData(): ContactFormData {
  return {
    firstName: faker.person.firstName(),
    lastName:  faker.person.lastName(),
    email:     faker.internet.email(),
    phone:     faker.phone.number(),
    subject:   faker.lorem.words(4),
    message:   faker.lorem.paragraph(2),
  };
}

/**
 * Generates realistic career application form data using Faker.
 */
export function generateCareerData(): CareerFormData {
  return {
    firstName:   faker.person.firstName(),
    lastName:    faker.person.lastName(),
    email:       faker.internet.email(),
    phone:       faker.phone.number(),
    position:    faker.person.jobTitle(),
    coverLetter: faker.lorem.paragraphs(2),
    linkedIn:    `https://linkedin.com/in/${faker.internet.username()}`,
  };
}

/**
 * Generates a unique registration data set.
 * Password always satisfies common complexity requirements.
 */
export function generateRegistrationData(): RegistrationData {
  const password = 'Test@' + faker.string.alphanumeric(8) + '1!';
  return {
    username:        faker.internet.username(),
    email:           faker.internet.email(),
    password,
    confirmPassword: password,
    firstName:       faker.person.firstName(),
    lastName:        faker.person.lastName(),
  };
}
