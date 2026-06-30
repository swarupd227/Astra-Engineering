import { useState, useRef, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Play, ArrowLeft, Share2, Copy, Check } from "lucide-react";
import { Link } from "wouter";
import productTourVideo from "@assets/Introducing_NAT_2.0__The_Next_Generation_of_Autonomous_Testing_1767190448585.mp4";

const playbackSpeeds = [
  { value: 1, label: '1x' },
  { value: 1.2, label: '1.2x' },
  { value: 1.5, label: '1.5x' },
  { value: 2, label: '2x' },
];

export default function ProductTourPage() {
  const [playbackSpeed, setPlaybackSpeed] = useState(1);
  const [copied, setCopied] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    if (videoRef.current) {
      videoRef.current.playbackRate = playbackSpeed;
    }
  }, [playbackSpeed]);

  const handleCopyLink = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy link:', err);
    }
  };

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <header className="border-b border-border p-4">
        <div className="flex items-center justify-between">
          <Link href="/help">
            <Button variant="ghost" size="sm" data-testid="button-back-to-help">
              <ArrowLeft className="w-4 h-4 mr-2" />
              Back to Help
            </Button>
          </Link>
          <Button 
            variant="outline" 
            size="sm" 
            onClick={handleCopyLink}
            data-testid="button-copy-link"
          >
            {copied ? (
              <>
                <Check className="w-4 h-4 mr-2 text-green-500" />
                Copied!
              </>
            ) : (
              <>
                <Share2 className="w-4 h-4 mr-2" />
                Copy Link
              </>
            )}
          </Button>
        </div>
      </header>

      <main className="flex-1 flex flex-col items-center justify-center p-6">
        <div className="w-full space-y-6">
          <div className="text-center">
            <h1 className="text-3xl font-bold text-foreground flex items-center justify-center gap-3">
              <Play className="w-8 h-8 text-cyan-400" />
              Platform Tour
            </h1>
            <p className="text-muted-foreground mt-2">
              The Future of Autonomous Testing
            </p>
          </div>

          <Card className="bg-card/50 border-border/50">
            <CardContent className="p-4">
              <div className="flex items-center justify-between mb-4">
                <span className="text-sm text-muted-foreground">Playback Speed:</span>
                <div className="flex items-center gap-2">
                  {playbackSpeeds.map((speed) => (
                    <Button
                      key={speed.value}
                      size="sm"
                      variant={playbackSpeed === speed.value ? "default" : "outline"}
                      onClick={() => setPlaybackSpeed(speed.value)}
                      data-testid={`button-speed-${speed.label}`}
                      className="px-3 py-1 h-7 text-xs"
                    >
                      {speed.label}
                    </Button>
                  ))}
                </div>
              </div>
              <div className="aspect-video bg-black rounded-lg overflow-hidden">
                <video
                  ref={videoRef}
                  src={productTourVideo}
                  controls
                  autoPlay
                  className="w-full h-full"
                  data-testid="video-product-tour"
                  onLoadedMetadata={() => {
                    if (videoRef.current) {
                      videoRef.current.playbackRate = playbackSpeed;
                    }
                  }}
                />
              </div>
            </CardContent>
          </Card>

          <div className="text-center">
            <p className="text-sm text-muted-foreground mb-4">
              Share this URL with your team to give them direct access to the platform tour
            </p>
            <div className="inline-flex items-center gap-2 px-4 py-2 bg-muted/50 rounded-lg border border-border">
              <code className="text-sm text-foreground" data-testid="text-share-url">
                {typeof window !== 'undefined' ? window.location.href : '/product-tour'}
              </code>
              <Button 
                variant="ghost" 
                size="icon" 
                onClick={handleCopyLink}
                data-testid="button-copy-url-icon"
                className="h-6 w-6"
              >
                {copied ? (
                  <Check className="w-3 h-3 text-green-500" />
                ) : (
                  <Copy className="w-3 h-3" />
                )}
              </Button>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
