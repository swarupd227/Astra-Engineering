import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { Mail, Phone, MapPin, HelpCircle, BookOpen, MessageSquare, FileText, ExternalLink } from "lucide-react";
import { Link } from "wouter";

export default function Help() {
  const { toast } = useToast();
  const [formData, setFormData] = useState({
    name: "",
    email: "",
    subject: "",
    message: "",
  });
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);

    // Simulate form submission
    setTimeout(() => {
      toast({
        title: "Message sent",
        description: "We'll get back to you within 24 hours on business days.",
      });
      setFormData({ name: "", email: "", subject: "", message: "" });
      setIsSubmitting(false);
    }, 1000);
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
  };

  return (
    <div className="flex-1 space-y-6 p-6">
      <PageHeader
        icon={HelpCircle}
        title="Help & Support"
        subtitle="Get assistance and find answers to your questions"
        color="blue"
      />

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Contact Form */}
        <div className="lg:col-span-2">
          <Card className="border-l-[3px] border-l-blue-500">
            <CardHeader>
              <CardTitle>Contact Us</CardTitle>
              <CardDescription>
                Send us a message and we'll get back to you as soon as possible.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="name">
                      Name <span className="text-destructive">*</span>
                    </Label>
                    <Input
                      id="name"
                      name="name"
                      placeholder="Your name"
                      value={formData.name}
                      onChange={handleInputChange}
                      required
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="email">
                      Email <span className="text-destructive">*</span>
                    </Label>
                    <Input
                      id="email"
                      name="email"
                      type="email"
                      placeholder="your.email@example.com"
                      value={formData.email}
                      onChange={handleInputChange}
                      required
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="subject">
                    Subject <span className="text-destructive">*</span>
                  </Label>
                  <Input
                    id="subject"
                    name="subject"
                    placeholder="What is this regarding?"
                    value={formData.subject}
                    onChange={handleInputChange}
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="message">
                    Message <span className="text-destructive">*</span>
                  </Label>
                  <Textarea
                    id="message"
                    name="message"
                    placeholder="Tell us how we can help..."
                    rows={6}
                    value={formData.message}
                    onChange={handleInputChange}
                    required
                  />
                </div>
                <Button type="submit" disabled={isSubmitting} className="w-full">
                  {isSubmitting ? "Sending..." : "Send Message"}
                </Button>
              </form>
            </CardContent>
          </Card>
        </div>

        {/* Contact Information */}
        <div className="space-y-6">
          <Card className="border-l-[3px] border-l-blue-500">
            <CardHeader>
              <CardTitle>Get in Touch</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-start gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-md bg-primary/10">
                  <Mail className="h-5 w-5 text-primary" />
                </div>
                <div>
                  <p className="font-medium">Email</p>
                  <a
                    href="mailto:info@nousinfo.com"
                    className="text-sm text-muted-foreground hover:text-primary transition-colors"
                  >
                    info@nousinfo.com
                  </a>
                </div>
              </div>
              <div className="flex items-start gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-md bg-primary/10">
                  <Phone className="h-5 w-5 text-primary" />
                </div>
                <div>
                  <p className="font-medium">Phone</p>
                  <a
                    href="tel:+17329859533"
                    className="text-sm text-muted-foreground hover:text-primary transition-colors"
                  >
                    +1 732 985 9533
                  </a>
                </div>
              </div>
              <div className="flex items-start gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-md bg-primary/10">
                  <MapPin className="h-5 w-5 text-primary" />
                </div>
                <div>
                  <p className="font-medium">Address</p>
                  <p className="text-sm text-muted-foreground">
                    200 Metroplex Drive, Suite 302
                    <br />
                    Edison, NJ 08817
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Quick Help Resources */}
          <Card className="border-l-[3px] border-l-blue-500">
            <CardHeader>
              <CardTitle>Quick Help</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <Button variant="outline" className="w-full justify-start" asChild>
                <Link href="/overview">
                  <HelpCircle className="h-4 w-4 mr-2" />
                  Dashboard Guide
                </Link>
              </Button>
              <Button variant="outline" className="w-full justify-start" asChild>
                <Link href="/projects">
                  <BookOpen className="h-4 w-4 mr-2" />
                  Project Management
                </Link>
              </Button>
              <Button variant="outline" className="w-full justify-start" asChild>
                <Link href="/settings">
                  <FileText className="h-4 w-4 mr-2" />
                  Settings & Configuration
                </Link>
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Locations Section */}
      <div>
        <h3 className="text-2xl font-semibold mb-6">Our Locations</h3>
        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          {/* North America */}
          <Card className="border-l-[3px] border-l-blue-500">
            <CardHeader>
              <CardTitle className="text-lg">North America</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <p className="font-semibold mb-2">USA - Edison, NJ</p>
                <p className="text-sm text-muted-foreground mb-1">
                  200 Metroplex Drive, Suite 302
                  <br />
                  Edison, NJ 08817
                </p>
                <div className="flex flex-col gap-1 mt-2">
                  <a
                    href="mailto:info@nousinfo.com"
                    className="text-xs text-muted-foreground hover:text-primary"
                  >
                    info@nousinfo.com
                  </a>
                  <a
                    href="tel:+17329859533"
                    className="text-xs text-muted-foreground hover:text-primary"
                  >
                    +1 732 985 9533
                  </a>
                </div>
              </div>
              <div className="border-t pt-4">
                <p className="font-semibold mb-2">USA - Pleasanton, CA</p>
                <p className="text-sm text-muted-foreground mb-1">
                  4695 Chabot Drive, Suite 200
                  <br />
                  Pleasanton, CA 94588
                </p>
                <a
                  href="mailto:info@nousinfo.com"
                  className="text-xs text-muted-foreground hover:text-primary"
                >
                  info@nousinfo.com
                </a>
              </div>
              <div className="border-t pt-4">
                <p className="font-semibold mb-2">Canada - Toronto, ON</p>
                <p className="text-sm text-muted-foreground mb-1">
                  251 Consumers Rd., Suite 1209
                  <br />
                  Toronto, ON M2J 4R3
                </p>
                <a
                  href="mailto:info@nousinfo.com"
                  className="text-xs text-muted-foreground hover:text-primary"
                >
                  info@nousinfo.com
                </a>
              </div>
            </CardContent>
          </Card>

          {/* Europe */}
          <Card className="border-l-[3px] border-l-blue-500">
            <CardHeader>
              <CardTitle className="text-lg">Europe</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <p className="font-semibold mb-2">UK - London</p>
                <p className="text-sm text-muted-foreground mb-1">
                  Profile West, 950 Great West Road
                  <br />
                  Brentford, Greater London, TW8 9ES
                </p>
                <a
                  href="mailto:info@nousinfo.com"
                  className="text-xs text-muted-foreground hover:text-primary"
                >
                  info@nousinfo.com
                </a>
              </div>
              <div className="border-t pt-4">
                <p className="font-semibold mb-2">Germany - Dresden</p>
                <p className="text-sm text-muted-foreground mb-1">
                  Chemnitzer Strasse 46
                  <br />
                  Dresden, Sachsen, 01187
                </p>
                <a
                  href="mailto:info@nousinfo.com"
                  className="text-xs text-muted-foreground hover:text-primary"
                >
                  info@nousinfo.com
                </a>
              </div>
              <div className="border-t pt-4">
                <p className="font-semibold mb-2">Serbia - Belgrade</p>
                <p className="text-sm text-muted-foreground mb-1">
                  Gospodara Vučića 145
                  <br />
                  Belgrade, 11000
                </p>
                <a
                  href="mailto:info@nousinfo.com"
                  className="text-xs text-muted-foreground hover:text-primary"
                >
                  info@nousinfo.com
                </a>
              </div>
            </CardContent>
          </Card>

          {/* APAC */}
          <Card className="border-l-[3px] border-l-blue-500">
            <CardHeader>
              <CardTitle className="text-lg">APAC</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <p className="font-semibold mb-2">India - Bengaluru</p>
                <p className="text-sm text-muted-foreground mb-1">
                  #983-985, 7th Cross, 24th Main HSR 1st Sector
                  <br />
                  Bengaluru – 560 102
                </p>
                <div className="flex flex-col gap-1 mt-2">
                  <a
                    href="mailto:info@nousinfo.com"
                    className="text-xs text-muted-foreground hover:text-primary"
                  >
                    info@nousinfo.com
                  </a>
                  <a
                    href="tel:+918042603000"
                    className="text-xs text-muted-foreground hover:text-primary"
                  >
                    +91 80 42603000
                  </a>
                </div>
              </div>
              <div className="border-t pt-4">
                <p className="font-semibold mb-2">India - Coimbatore</p>
                <p className="text-sm text-muted-foreground mb-1">
                  Rathinam Techno Park, Pollachi Main Road
                  <br />
                  Coimbatore – 641 021
                </p>
                <div className="flex flex-col gap-1 mt-2">
                  <a
                    href="mailto:info@nousinfo.com"
                    className="text-xs text-muted-foreground hover:text-primary"
                  >
                    info@nousinfo.com
                  </a>
                  <a
                    href="tel:+914224300300"
                    className="text-xs text-muted-foreground hover:text-primary"
                  >
                    +91 422 4300300
                  </a>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Additional Resources */}
      <div>
        <h3 className="text-2xl font-semibold mb-6">Additional Resources</h3>
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          <Card className="border-l-[3px] border-l-blue-500">
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <BookOpen className="h-5 w-5" />
                Documentation
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground mb-4">
                Access comprehensive guides and documentation for all features.
              </p>
              <Button variant="outline" size="sm" className="w-full" asChild>
                <Link href="/overview">
                  View Docs <ExternalLink className="h-3 w-3 ml-2" />
                </Link>
              </Button>
            </CardContent>
          </Card>

          <Card className="border-l-[3px] border-l-blue-500">
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <MessageSquare className="h-5 w-5" />
                Community
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground mb-4">
                Join our community to get help and share knowledge.
              </p>
              <Button variant="outline" size="sm" className="w-full" disabled>
                Coming Soon
              </Button>
            </CardContent>
          </Card>

          <Card className="border-l-[3px] border-l-blue-500">
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <FileText className="h-5 w-5" />
                Knowledge Base
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground mb-4">
                Browse articles and FAQs to find quick answers.
              </p>
              <Button variant="outline" size="sm" className="w-full" asChild>
                <Link href="/hub/knowledge-base">
                  Browse KB <ExternalLink className="h-3 w-3 ml-2" />
                </Link>
              </Button>
            </CardContent>
          </Card>

          <Card className="border-l-[3px] border-l-blue-500">
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <HelpCircle className="h-5 w-5" />
                Support Portal
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground mb-4">
                Visit our support portal for additional resources.
              </p>
              <Button variant="outline" size="sm" className="w-full" asChild>
                <a
                  href="https://www.nousinfosystems.com/contact-us"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Visit Portal <ExternalLink className="h-3 w-3 ml-2" />
                </a>
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

