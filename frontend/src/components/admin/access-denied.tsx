import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"

export function AccessDenied({ message }: { message: string }) {
  return (
    <Card className="max-w-md border-dashed">
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Access denied</CardTitle>
        <CardDescription>{message}</CardDescription>
      </CardHeader>
      <CardContent className="text-sm text-muted-foreground">
        You do not have permission to view this page. Contact an administrator if you need access.
      </CardContent>
    </Card>
  )
}
